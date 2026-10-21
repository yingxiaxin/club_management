import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')
const langPath = path.resolve(__dirname, '../tessdata')

const meta = await sharp(img).metadata()
const w = meta.width
const h = meta.height

async function ocrRegion(label, box) {
  const buf = await sharp(img)
    .extract(box)
    .greyscale()
    .negate()
    .normalize()
    .linear(1.7, -50)
    .resize({ width: Math.max(box.width * 3, 600), kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()
  await sharp(buf).toFile(path.resolve(__dirname, `../data/_ocr-${label}.png`))
  const worker = await createWorker('chi_sim', 1, {
    langPath,
    gzip: false,
    cacheMethod: 'none',
  })
  await worker.setParameters({ tessedit_pageseg_mode: '6' })
  const { data } = await worker.recognize(buf)
  await worker.terminate()
  console.log(`\n=== ${label} ===`)
  console.log(data.text)
  return data.text
}

const top = Math.round(h * 0.20)
const height = Math.round(h * 0.62)

// 姓名列：跳过序号与头像
await ocrRegion('names', {
  left: Math.round(w * 0.195),
  top,
  width: Math.round(w * 0.095),
  height,
})

// 职位+途径+评分整块
await ocrRegion('stats', {
  left: Math.round(w * 0.29),
  top,
  width: Math.round(w * 0.42),
  height,
})
