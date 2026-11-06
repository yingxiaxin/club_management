/**
 * 登录后的使用手册：读 docs/使用手册.html，把配图嵌成 data URI。
 * 不把手册放到管理端静态目录，避免公网未登录即可打开。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs')
const imgDir = path.join(docsDir, '使用手册-配图')

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function renderManualHtml() {
  const htmlPath = path.join(docsDir, '使用手册.html')
  if (!fs.existsSync(htmlPath)) throw err('使用手册文件不存在', 404)
  const html = fs.readFileSync(htmlPath, 'utf8')
  return html.replace(/src="(使用手册-配图\/[^"]+)"/g, (full, rel) => {
    const name = path.basename(rel)
    const file = path.resolve(imgDir, name)
    if (!file.startsWith(imgDir + path.sep) && file !== imgDir) return full
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return full
    const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const b64 = fs.readFileSync(file).toString('base64')
    return `src="data:${mime};base64,${b64}"`
  })
}
