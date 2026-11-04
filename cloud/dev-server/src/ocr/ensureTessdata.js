import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_TESSDATA = path.resolve(__dirname, '../../tessdata')

/** 国内直连 GitHub 常超时；按序尝试镜像，最后回退官方 */
const REMOTE_CANDIDATES = [
  'https://ghfast.top/https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata',
  'https://raw.gitmirror.com/tesseract-ocr/tessdata/main/chi_sim.traineddata',
  'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata@main/chi_sim.traineddata',
  'https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata',
]

function asciiCacheDir() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    process.env.HOME ||
    process.cwd()
  return path.join(base, 'club-management-tessdata')
}

function downloadOnce(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const lib = url.startsWith('http://') ? http : https
    const req = lib.get(url, { timeout: 60_000 }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        file.close()
        try {
          fs.unlinkSync(dest)
        } catch {
          /* ignore */
        }
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href
        return downloadOnce(next, dest, redirectsLeft - 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        try {
          fs.unlinkSync(dest)
        } catch {
          /* ignore */
        }
        return reject(new Error(`下载 tessdata 失败: HTTP ${res.statusCode} (${url})`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    })
    req.on('timeout', () => {
      req.destroy(new Error(`下载 tessdata 超时 (${url})`))
    })
    req.on('error', (err) => {
      file.close()
      try {
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      reject(err)
    })
  })
}

async function downloadWithMirrors(dest) {
  const errors = []
  for (const url of REMOTE_CANDIDATES) {
    const tmp = `${dest}.tmp`
    try {
      console.log('[ocr] 尝试下载 chi_sim.traineddata:', url)
      await downloadOnce(url, tmp)
      const size = fs.statSync(tmp).size
      if (size < 1_000_000) {
        throw new Error(`文件过小 (${size} bytes)`)
      }
      fs.renameSync(tmp, dest)
      return
    } catch (err) {
      errors.push(`${url} → ${err.message || err}`)
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`所有镜像均失败:\n${errors.join('\n')}`)
}

/**
 * 返回可用的 chi_sim tessdata 目录（优先仓库内 tessdata，否则用户缓存目录）。
 * 中文路径下 WASM 偶发乱码，故缓存落到 LOCALAPPDATA 等 ASCII 友好路径。
 */
export async function ensureTessdata() {
  const candidates = [LOCAL_TESSDATA, asciiCacheDir()]
  for (const dir of candidates) {
    const file = path.join(dir, 'chi_sim.traineddata')
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) {
      return dir
    }
  }

  const dir = asciiCacheDir()
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, 'chi_sim.traineddata')
  console.log('[ocr] 首次使用，下载 chi_sim.traineddata …')
  await downloadWithMirrors(dest)
  console.log('[ocr] tessdata 已就绪:', dest)
  return dir
}
