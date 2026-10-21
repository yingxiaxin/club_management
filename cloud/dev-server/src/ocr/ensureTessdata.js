import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_TESSDATA = path.resolve(__dirname, '../../tessdata')
const REMOTE = 'https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata'

function asciiCacheDir() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    process.env.HOME ||
    process.cwd()
  return path.join(base, 'club-management-tessdata')
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close()
          fs.unlinkSync(dest)
          return download(res.headers.location, dest).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          return reject(new Error(`下载 tessdata 失败: HTTP ${res.statusCode}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      })
      .on('error', (err) => {
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
  const tmp = `${dest}.tmp`
  console.log('[ocr] 首次使用，下载 chi_sim.traineddata …')
  await download(REMOTE, tmp)
  fs.renameSync(tmp, dest)
  console.log('[ocr] tessdata 已就绪:', dest)
  return dir
}
