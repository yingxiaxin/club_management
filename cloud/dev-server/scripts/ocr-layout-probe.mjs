import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ensureTessdata } from '../src/ocr/ensureTessdata.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')
const langPath = await ensureTessdata()

const meta = await sharp(img).metadata()
const w = meta.width
const h = meta.height
const left = Math.round(w * 0.145)
const top = Math.round(h * 0.175)
const width = Math.round(w * 0.83)
const height = Math.round(h * 0.68)

const table = await sharp(img)
  .extract({ left, top, width, height })
  .png()
  .toBuffer()

const worker = await createWorker('chi_sim', 1, { langPath, gzip: false, cacheMethod: 'none' })
await worker.setParameters({ tessedit_pageseg_mode: '11' }) // sparse
const { data } = await worker.recognize(table)
await worker.terminate()

const words = (data.words || [])
  .filter((x) => x.text?.trim() && x.confidence > 20)
  .map((x) => ({
    t: x.text.replace(/\s+/g, ''),
    x0: x.bbox.x0,
    x1: x.bbox.x1,
    y0: x.bbox.y0,
    y1: x.bbox.y1,
    conf: Math.round(x.confidence),
  }))

// cluster by y
const rows = []
for (const word of words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
  const mid = (word.y0 + word.y1) / 2
  let row = rows.find((r) => Math.abs(r.y - mid) < 22)
  if (!row) {
    row = { y: mid, words: [] }
    rows.push(row)
  }
  row.words.push(word)
  row.y = (row.y * (row.words.length - 1) + mid) / row.words.length
}

console.log('table size', width, height, 'rows', rows.length)
for (const row of rows.slice(0, 15)) {
  row.words.sort((a, b) => a.x0 - b.x0)
  console.log(
    'y=' + Math.round(row.y),
    row.words.map((w) => `${w.t}@${w.x0}`).join(' | '),
  )
}

// Try per-row name crops: name roughly x 90-220 in table coords (after avatar)
const nameLeft = Math.round(width * 0.055)
const nameWidth = Math.round(width * 0.12)
const outDir = path.resolve(__dirname, '../data/_name-rows')
fs.mkdirSync(outDir, { recursive: true })

const worker2 = await createWorker('chi_sim', 1, { langPath, gzip: false, cacheMethod: 'none' })
await worker2.setParameters({ tessedit_pageseg_mode: '7' })

// estimate row bands from title hits
const titleRows = rows.filter((r) =>
  r.words.some((w) => /会长|外交|俱乐部|正式|会员|星/.test(w.t)),
)
console.log('\nname crops:')
for (let i = 0; i < Math.min(titleRows.length, 10); i++) {
  const r = titleRows[i]
  const y0 = Math.max(0, Math.round(r.y - 28))
  const y1 = Math.min(height, Math.round(r.y + 28))
  const band = await sharp(table)
    .extract({ left: nameLeft, top: y0, width: nameWidth, height: y1 - y0 })
    .greyscale()
    .negate()
    .normalize()
    .linear(1.8, -40)
    .resize({ width: nameWidth * 4, kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(outDir, `row-${i}.png`), band)
  const { data: d } = await worker2.recognize(band)
  console.log(i, 'y', Math.round(r.y), JSON.stringify(d.text.trim()))
}
await worker2.terminate()
