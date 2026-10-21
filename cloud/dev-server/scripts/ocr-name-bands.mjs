import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ensureTessdata } from '../src/ocr/ensureTessdata.js'
import { parseMemberListText } from '../src/ocr/parseMemberList.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')
const langPath = await ensureTessdata()
const outDir = path.resolve(__dirname, '../data/_name-bands')
fs.mkdirSync(outDir, { recursive: true })

const meta = await sharp(img).metadata()
const w = meta.width
const h = meta.height

// 表体区域（整屏）
const table = {
  left: Math.round(w * 0.145),
  top: Math.round(h * 0.20),
  width: Math.round(w * 0.83),
  height: Math.round(h * 0.62),
}

const tableBuf = await sharp(img).extract(table).png().toBuffer()
const tw = table.width
const th = table.height

// 右侧：职位起（跳过头像）— 结构识别
const statsLeft = Math.round(tw * 0.14)
const statsBuf = await sharp(tableBuf)
  .extract({ left: statsLeft, top: 0, width: tw - statsLeft, height: th })
  .greyscale()
  .negate()
  .normalize()
  .linear(1.6, -35)
  .resize({ width: Math.round((tw - statsLeft) * 2), kernel: 'lanczos3' })
  .sharpen()
  .png()
  .toBuffer()

const worker = await createWorker('chi_sim', 1, { langPath, gzip: false, cacheMethod: 'none' })
await worker.setParameters({ tessedit_pageseg_mode: '6' })
const statsOcr = await worker.recognize(statsBuf)
console.log('=== STATS ===\n', statsOcr.data.text)
const statsRows = parseMemberListText(statsOcr.data.text)
console.log(
  'stats parsed',
  statsRows.length,
  statsRows.map((r) => `${r.title}|${r.powerScore}`).join(' ;; '),
)

// 姓名列：头像右侧一小条
const nameLeft = Math.round(tw * 0.055)
const nameWidth = Math.round(tw * 0.095)

// 按等分行带切（表头约占 8%，其余 9 行）
const headerFrac = 0.02
const rowCount = Math.max(statsRows.length, 9)
const usableTop = Math.round(th * headerFrac)
const usableH = th - usableTop
const rowH = usableH / rowCount

await worker.setParameters({ tessedit_pageseg_mode: '7' })
const names = []
for (let i = 0; i < rowCount; i++) {
  const y0 = Math.max(0, Math.round(usableTop + i * rowH + rowH * 0.12))
  const bandH = Math.max(20, Math.round(rowH * 0.76))
  const band = await sharp(tableBuf)
    .extract({ left: nameLeft, top: y0, width: nameWidth, height: Math.min(bandH, th - y0) })
    .greyscale()
    .negate()
    .normalize()
    .linear(1.9, -45)
    .resize({ width: nameWidth * 5, height: bandH * 5, kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(outDir, `name-${i}.png`), band)
  const { data } = await worker.recognize(band)
  const raw = data.text.replace(/\s+/g, '').replace(/[^\u4e00-\u9fffA-Za-z0-9·.•]/g, '')
  names.push(raw)
  console.log(i, raw || '(empty)', 'conf', Math.round(data.confidence || 0))
}
await worker.terminate()

console.log('\n=== MERGED ===')
for (let i = 0; i < statsRows.length; i++) {
  const n = names[i] || statsRows[i].characterName
  console.log(`${n} | ${statsRows[i].title} | ${statsRows[i].pathway} | ${statsRows[i].powerScore}`)
}
