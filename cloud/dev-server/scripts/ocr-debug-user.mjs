import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ensureTessdata } from '../src/ocr/ensureTessdata.js'
import { parseMemberListText } from '../src/ocr/parseMemberList.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = String.raw`C:\Users\20081\.cursor\projects\d\assets\c__Users_20081_AppData_Roaming_Cursor_User_workspaceStorage_d4948dd60208af838af14cfc8bb00f65_images_image-371ea617-41c9-430c-912c-d1bbfd12b594.png`
const full = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')

async function ocrBuf(label, buf, psm = '6') {
  const langPath = await ensureTessdata()
  const worker = await createWorker('chi_sim', 1, { langPath, gzip: false, cacheMethod: 'none' })
  await worker.setParameters({ tessedit_pageseg_mode: psm })
  const { data } = await worker.recognize(buf)
  await worker.terminate()
  console.log(`\n===== ${label} psm=${psm} =====`)
  console.log(data.text)
  const parsed = parseMemberListText(data.text)
  console.log('parsed', parsed.length, parsed.map((p) => `${p.characterName}|${p.title}|${p.powerScore}`).join(' ;; '))
  return data.text
}

async function prepVariants(file) {
  const meta = await sharp(file).metadata()
  console.log('\nfile', path.basename(file), meta.width, meta.height)
  const raw = await sharp(file).png().toBuffer()

  // current pipeline (always crop)
  const w = meta.width
  const h = meta.height
  const left = Math.round(w * 0.145)
  const top = Math.round(h * 0.175)
  const width = Math.max(100, Math.round(w * 0.83))
  const height = Math.max(100, Math.round(h * 0.68))
  const cropped = await sharp(file)
    .extract({
      left: Math.min(left, w - 10),
      top: Math.min(top, h - 10),
      width: Math.min(width, w - left),
      height: Math.min(height, h - top),
    })
    .greyscale()
    .negate()
    .normalize()
    .linear(1.6, -40)
    .resize({ width: Math.min(width * 2, 3200), kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()

  const noCrop = await sharp(file)
    .greyscale()
    .negate()
    .normalize()
    .linear(1.6, -40)
    .resize({ width: Math.min(w * 2, 3200), kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()

  // name-focused: skip left rank+avatar roughly 12% then take next 12%
  const nameCol = await sharp(file)
    .extract({
      left: Math.round(w * 0.08),
      top: 0,
      width: Math.max(40, Math.round(w * 0.14)),
      height: h,
    })
    .greyscale()
    .negate()
    .normalize()
    .linear(1.8, -30)
    .resize({ width: Math.max(400, Math.round(w * 0.14 * 3)), kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer()

  fs.writeFileSync(path.resolve(__dirname, `../data/_dbg-${path.basename(file)}-crop.png`), cropped)
  fs.writeFileSync(path.resolve(__dirname, `../data/_dbg-${path.basename(file)}-nocrop.png`), noCrop)
  fs.writeFileSync(path.resolve(__dirname, `../data/_dbg-${path.basename(file)}-name.png`), nameCol)

  await ocrBuf(`${path.basename(file)} CURRENT-CROP`, cropped, '6')
  await ocrBuf(`${path.basename(file)} NO-CROP`, noCrop, '6')
  await ocrBuf(`${path.basename(file)} NO-CROP psm4`, noCrop, '4')
  await ocrBuf(`${path.basename(file)} NAME-COL`, nameCol, '6')
  await ocrBuf(`${path.basename(file)} RAW`, raw, '6')
}

await prepVariants(img)
await prepVariants(full)
