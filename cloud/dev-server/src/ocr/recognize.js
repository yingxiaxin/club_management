import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ensureTessdata } from './ensureTessdata.js'
import { humanizeNetworkError, isTransientNetworkError } from './netError.js'
import { parseMemberListText } from './parseMemberList.js'
import { isRapidOcrAvailable, recognizeWithRapid } from './rapidOcr.js'
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

function tableBox(w, h) {
  const left = Math.round(w * 0.145)
  const top = Math.round(h * 0.175)
  const width = Math.max(100, Math.round(w * 0.83))
  const height = Math.max(100, Math.round(h * 0.68))
  return {
    left: Math.min(left, w - 10),
    top: Math.min(top, h - 10),
    width: Math.min(width, w - left),
    height: Math.min(height, h - top),
  }
}

async function makeTableCrop(buffer, w, h) {
  const box = tableBox(w, h)
  const cropped = sharp(buffer).extract(box)
  return enhance(cropped, box.width * 2)
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
  const nameScore = (n) => (n.length >= 2 ? 10 : 0) + n.length + (/[\u4e00-\u9fff]/.test(n) ? 3 : 0)
  const prevScore = nameScore(prevName) + (prev.confidence || 0) * 5 + (prev.level ? 1 : 0)
  const nextScore = nameScore(nextName) + (row.confidence || 0) * 5 + (row.level ? 1 : 0)
  if (nextScore > prevScore) {
    map.set(key, {
      ...prev,
      ...row,
      // 保留更完整姓名；结构字段取非空更优值
      characterName: nameScore(nextName) >= nameScore(prevName) ? nextName : prevName,
      level: row.level || prev.level || 0,
      title: row.title && row.title !== '成员' ? row.title : prev.title,
      pathway: row.pathway && row.pathway !== '未填写' ? row.pathway : prev.pathway,
    })
  } else {
    map.set(key, {
      ...prev,
      level: prev.level || row.level || 0,
      characterName: nameScore(prevName) >= nameScore(nextName) ? prevName : nextName,
    })
  }
}

function markNameReview(row, provider) {
  const name = row.characterName || ''
  const weakName = !name || name.length < 2
  const forceReview = provider === 'tesseract' || provider === 'tesseract-fallback'
  const low = Boolean(row.lowConfidence) || weakName || forceReview
  const issues = [...(row.issues || [])]
  if (forceReview || weakName) {
    issues.push('角色名易受头像遮挡，请人工核对')
  }
  return {
    ...row,
    lowConfidence: low,
    issues: Array.from(new Set(issues)),
  }
}

/** Tesseract：整表 + 统计列（职位起）双通道，结构更稳 */
async function recognizeLocalTesseract(buf, meta) {
  const w = meta.width || 1920
  const h = meta.height || 1080
  const rawParts = []
  const merged = new Map()

  if (isFullGameUi(w, h)) {
    const box = tableBox(w, h)
    const tableBuf = await sharp(buf).extract(box).png().toBuffer()
    const tw = box.width
    const th = box.height

    // 统计列：从职位附近起，避免头像干扰职称/评分
    const statsLeft = Math.round(tw * 0.1)
    const statsBuf = await enhance(
      sharp(tableBuf).extract({ left: statsLeft, top: 0, width: tw - statsLeft, height: th }),
      (tw - statsLeft) * 2,
    )
    const stats = await recognizeBuffer(statsBuf)
    rawParts.push(`[tess-stats]\n${stats.rawText}`)
    for (const row of stats.candidates) mergeCandidate(merged, row)

    // 整表裁切：补角色名
    const fullTable = await enhance(sharp(tableBuf), tw * 2)
    const names = await recognizeBuffer(fullTable)
    rawParts.push(`[tess-table]\n${names.rawText}`)
    for (const row of names.candidates) mergeCandidate(merged, row)

    if (merged.size < 5) {
      const extra = await recognizeBuffer(await enhance(sharp(buf), w * 2))
      rawParts.push(`[tess-full-fallback]\n${extra.rawText}`)
      for (const row of extra.candidates) mergeCandidate(merged, row)
    }
  } else {
    for (const [name, scale] of [
      ['full', 2.5],
      ['boost', 3.5],
    ]) {
      const result = await recognizeBuffer(await enhance(sharp(buf), w * scale))
      rawParts.push(`[tess-${name}]\n${result.rawText}`)
      for (const row of result.candidates) mergeCandidate(merged, row)
    }
    if (merged.size < 2) {
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
      rawParts.push(`[tess-alt]\n${extra.rawText}`)
      for (const row of extra.candidates) mergeCandidate(merged, row)
    }
  }

  return { rawParts, merged, provider: 'tesseract' }
}

async function recognizeLocal(buf, meta) {
  // 优先 RapidOCR（中文角色名明显更准）
  if (await isRapidOcrAvailable()) {
    try {
      const rapid = await recognizeWithRapid(buf, meta)
      const merged = new Map()
      for (const row of rapid.candidates) mergeCandidate(merged, row)

      // 行数偏少时用 Tesseract 补洞
      if (merged.size < 3) {
        const tess = await recognizeLocalTesseract(buf, meta)
        for (const row of tess.merged.values()) mergeCandidate(merged, row)
        return {
          rawParts: [`[rapidocr]\n${rapid.rawText}`, ...tess.rawParts],
          merged,
          provider: 'rapidocr+tesseract',
        }
      }
      return {
        rawParts: [`[rapidocr]\n${rapid.rawText}`],
        merged,
        provider: 'rapidocr',
      }
    } catch (err) {
      console.warn('[ocr] RapidOCR 失败，回退 Tesseract:', err.message)
    }
  }
  return recognizeLocalTesseract(buf, meta)
}

function tipFor(provider) {
  if (provider.startsWith('tencent')) {
    return '已使用腾讯云 OCR。请仍核对角色名后再导入。'
  }
  if (provider.startsWith('rapidocr')) {
    return '已使用本地 RapidOCR（坐标版面解析）。角色名通常较准，请仍快速扫一眼再导入。'
  }
  return '本地 Tesseract 角色名常被游戏头像遮挡认错，请人工改全后再导入。评分/职位通常较可信。可安装 Python 包 rapidocr_onnxruntime，或配置腾讯云 OCR 密钥以提升准确率。'
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
        console.warn(
          '[ocr] 腾讯云 OCR 失败，回退本地引擎:',
          humanizeNetworkError(err, '腾讯云 OCR'),
        )
        try {
          const local = await recognizeLocal(buf, meta)
          rawParts.push(...local.rawParts)
          list = [...local.merged.values()]
          provider = local.provider.includes('rapid') ? 'rapidocr-fallback' : 'tesseract-fallback'
        } catch (localErr) {
          const tMsg = humanizeNetworkError(err, '腾讯云 OCR')
          const lMsg = humanizeNetworkError(localErr, '本地 OCR')
          throw Object.assign(new Error(`${tMsg}；且本地回退也失败：${lMsg}`), {
            status: 502,
            cause: localErr,
          })
        }
      }
    } else {
      try {
        const local = await recognizeLocal(buf, meta)
        rawParts.push(...local.rawParts)
        list = [...local.merged.values()]
        provider = local.provider
      } catch (localErr) {
        throw Object.assign(new Error(humanizeNetworkError(localErr, '本地 OCR')), {
          status: isTransientNetworkError(localErr) ? 502 : 500,
          cause: localErr,
        })
      }
    }

    for (const row of list) mergeCandidate(merged, row)
  }

  const candidates = [...merged.values()]
    .map((row) => markNameReview(row, provider))
    .sort((a, b) => b.powerScore - a.powerScore)

  return {
    rawText: rawParts.join('\n\n'),
    candidates,
    provider,
    tip: tipFor(provider),
  }
}
