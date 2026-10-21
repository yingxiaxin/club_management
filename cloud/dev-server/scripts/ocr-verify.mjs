import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recognizeMemberScreenshots } from '../src/ocr/recognize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const crop = path.resolve(
  'C:/Users/20081/.cursor/projects/d/assets/c__Users_20081_AppData_Roaming_Cursor_User_workspaceStorage_d4948dd60208af838af14cfc8bb00f65_images_image-371ea617-41c9-430c-912c-d1bbfd12b594.png',
)
const full = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')

async function run(label, file) {
  console.log('\n===', label, '===')
  const { candidates } = await recognizeMemberScreenshots([fs.readFileSync(file)])
  console.log('rows', candidates.length)
  for (const c of candidates) {
    console.log(
      `${c.characterName || '(空)'} | ${c.title} | ${c.pathway} | ${c.powerScore} | ${c.fashionScore} | low=${c.lowConfidence}`,
    )
  }
  return candidates
}

const a = await run('user-crop', crop)
const b = await run('full', full)
if (a.length < 3) {
  console.error('FAIL: user crop expected >=3')
  process.exit(1)
}
if (b.length < 8) {
  console.error('FAIL: full expected >=8')
  process.exit(1)
}
console.log('\nVERIFY OK')
