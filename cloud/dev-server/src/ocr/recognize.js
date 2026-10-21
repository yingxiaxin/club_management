import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ensureTessdata } from './ensureTessdata.js'
import { parseMemberListText } from './parseMemberList.js'
import { isTencentOcrConfigured, recognizeWithTencent } from './tencentOcr.js'

let workerPromise = null
let jobCount = 0

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const langPath = await ensureTessdata()
      const worker = await createWorker('chi_sim', 1, {
        langPath,
        gzip: false,
        cacheMethod: 'none',
      })
      await worker.setParameters({ tessedit_pageseg_mode: '6' })
      return worker
    })()
  }
  return workerPromise
}

async function resetWorker() {
  if (workerPromise) {
    try {
      const w = await workerPromise
      await w.terminate()
    } catch {
      /* ignore */
    }
  }
  workerPromise = null
  jobCount = 0
}

/** 完整游戏窗体（约 16:9 且足够高）才裁侧栏/顶底；局部粘贴条不裁 */
function isFullGameUi(width, height) {
  if (!width || !height) return false
  const ratio = width / height
  return height >= 700 && ratio >= 1.45 && ratio <= 2.2
}

async function enhance(image, targetWidth) {
  return image
    .greyscale()
    .negate()
    .normalize()
    .linear(1.65, -35)
    .resize({
      width: Math.min(Math.max(targetWidth, 800), 3600),
      kernel: 'lanczos3',
    })
    .sharpen()
    .png()
    .toBuffer()
}

async function makeTableCrop(buffer, w, h) {
  const left = Math.round(w * 0.145)
  const top = Math.round(h * 0.175)
  const width = Math.max(100, Math.round(w * 0.83))
  const height = Math.max(100, Math.round(h * 0.68))
  const cropped = sharp(buffer).extract({
    left: Math.min(left, w - 10),
    top: Math.min(top, h - 10),
    width: Math.min(width, w - left),
    height: Math.min(height, h - top),
  })
  return enhance(cropped, width * 2)
}

async function recognizeBuffer(prepared) {
  const worker = await getWorker()
  const { data } = await worker.recognize(prepared)
  jobCount += 1
  if (jobCount >= 30) await resetWorker()
  const rawText = data.text || ''
  const candidates = parseMemberListText(rawText)
  return { rawText, candidates }
}

/** 同评分键合并：优先保留角色名更完整的一行 */
function mergeCandidate(map, row) {
  const key = `${row.powerScore}-${row.fashionScore}`
  const prev = map.get(key)
  if (!prev) {
    map.set(key, row)
    return
  }
  const prevName = prev.characterName || ''
  const nextName = row.characterName || ''
  const prevScore = (prevName.length >= 2 ? 10 : 0) + prevName.length + (prev.confidence || 0) * 5
  const nextScore = (nextName.length >= 2 ? 10 : 0) + nextName.length + (row.confidence || 0) * 5
  if (nextScore > prevScore) map.set(key, { ...prev, ...row })
}

function markNameReview(row) {
  return {
    ...row,
    lowConfidence: true,
    issues: Array.from(
      new Set([...(row.issues || []), '角色名易受头像遮挡，请人工核对']),
    ),
  }
}

async function recognizeLocal(buf, meta) {
  const w = meta.width || 1920
  const h = meta.height || 1080
  const passes = []
  const rawParts = []
  const merged = new Map()

  if (isFullGameUi(w, h)) {
    passes.push({ name: 'table-crop', buffer: await makeTableCrop(buf, w, h) })
  } else {
    passes.push({ name: 'full', buffer: await enhance(sharp(buf), w * 2.5) })
    passes.push({ name: 'boost', buffer: await enhance(sharp(buf), w * 3.5) })
  }

  for (const v of passes) {
    const result = await recognizeBuffer(v.buffer)
    rawParts.push(`[${v.name}]\n${result.rawText}`)
    for (const row of result.candidates) mergeCandidate(merged, row)
  }

  if (isFullGameUi(w, h) && merged.size < 5) {
    const extra = await recognizeBuffer(await enhance(sharp(buf), w * 2))
    rawParts.push(`[full-fallback]\n${extra.rawText}`)
    for (const row of extra.candidates) mergeCandidate(merged, row)
  }

  if (!isFullGameUi(w, h) && merged.size < 2) {
    const alt = await sharp(buf)
      .greyscale()
      .normalize()
      .linear(2.0, -60)
      .negate()
      .resize({ width: Math.min(w * 4, 3600), kernel: 'lanczos3' })
      .sharpen()
      .png()
      .toBuffer()
    const extra = await recognizeBuffer(alt)
    rawParts.push(`[alt]\n${extra.rawText}`)
    for (const row of extra.candidates) mergeCandidate(merged, row)
  }

  return { rawParts, merged }
}

/**
 * @param {Buffer[]} buffers
 */
export async function recognizeMemberScreenshots(buffers) {
  const rawParts = []
  const merged = new Map()
  let provider = 'tesseract'

  for (const buf of buffers) {
    const meta = await sharp(buf).metadata()
    let list = []

    if (isTencentOcrConfigured()) {
      try {
        const t = await recognizeWithTencent(buf)
        provider = t.provider
        rawParts.push(`[tencent:${t.provider}]\n${t.rawText}`)
        list = parseMemberListText(t.rawText)
      } catch (err) {
        console.warn('[ocr] 腾讯云 OCR 失败，回退本地 Tesseract:', err.message)
        const local = await recognizeLocal(buf, meta)
        rawParts.push(...local.rawParts)
        list = [...local.merged.values()]
        provider = 'tesseract-fallback'
      }
    } else {
      const local = await recognizeLocal(buf, meta)
      rawParts.push(...local.rawParts)
      list = [...local.merged.values()]
    }

    for (const row of list) mergeCandidate(merged, row)
  }

  const candidates = [...merged.values()]
    .map(markNameReview)
    .sort((a, b) => b.powerScore - a.powerScore)

  return {
    rawText: rawParts.join('\n\n'),
    candidates,
    provider,
    tip:
      provider.startsWith('tencent')
        ? '已使用腾讯云 OCR。请仍核对角色名后再导入。'
        : '本地 OCR 角色名常被游戏头像遮挡认错，请人工改全后再导入。评分/职位通常较可信。配置 TENCENTCLOUD_SECRET_ID/KEY 可启用腾讯云识别以提升准确率。',
  }
}
