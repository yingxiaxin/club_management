import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMemberListText } from './parseMemberList.js'
import { parseRapidLayout, rapidItemsToText } from './parseRapidLayout.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(__dirname, '../../scripts/rapidocr_cli.py')

let availability = null

function pythonCandidates() {
  const list = []
  if (process.env.OCR_PYTHON) list.push(process.env.OCR_PYTHON)
  if (process.platform === 'win32') {
    list.push('py', 'python', 'python3')
  } else {
    list.push('python3', 'python')
  }
  return [...new Set(list)]
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      ...opts,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: String(err.message || err) }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** 探测本机是否可用 RapidOCR（结果缓存） */
export async function isRapidOcrAvailable() {
  if (availability) return availability.ok
  if (process.env.OCR_ENGINE === 'tesseract') {
    availability = { ok: false, reason: 'forced tesseract' }
    return false
  }
  if (!fs.existsSync(CLI)) {
    availability = { ok: false, reason: 'cli missing' }
    return false
  }
  for (const py of pythonCandidates()) {
    const args =
      py === 'py' ? ['-3', '-c', 'import rapidocr_onnxruntime'] : ['-c', 'import rapidocr_onnxruntime']
    const r = await run(py, args)
    if (r.code === 0) {
      availability = { ok: true, python: py }
      return true
    }
  }
  availability = { ok: false, reason: 'python/rapidocr unavailable' }
  return false
}

async function runCliOnFile(imagePath) {
  const ok = await isRapidOcrAvailable()
  if (!ok) throw new Error(availability?.reason || 'RapidOCR 不可用')
  const py = availability.python
  const args = py === 'py' ? ['-3', CLI, imagePath] : [CLI, imagePath]
  const r = await run(py, args)
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || 'RapidOCR 失败').trim().slice(0, 300))
  }
  const line = r.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()
  let data
  try {
    data = JSON.parse(line)
  } catch {
    throw new Error('RapidOCR 输出非 JSON')
  }
  if (!data.ok) throw new Error(data.message || 'RapidOCR 失败')
  return data
}

/**
 * @param {Buffer} imageBuffer
 * @param {{width?:number,height?:number}} meta
 */
export async function recognizeWithRapid(imageBuffer, meta = {}) {
  const tmp = path.join(
    os.tmpdir(),
    `club-ocr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  )
  try {
    fs.writeFileSync(tmp, imageBuffer)
    const data = await runCliOnFile(tmp)
    const items = data.items || []
    const layoutRows = parseRapidLayout(items, meta)
    const rawText = rapidItemsToText(items)
    // 版面解析不足时回退文本解析
    const candidates =
      layoutRows.length >= 2 ? layoutRows : parseMemberListText(rawText)
    return {
      rawText,
      candidates,
      provider: 'rapidocr',
      itemCount: items.length,
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}
