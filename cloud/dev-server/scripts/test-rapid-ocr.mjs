import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recognizeMemberScreenshots } from '../src/ocr/recognize.js'
import { isRapidOcrAvailable } from '../src/ocr/rapidOcr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')
const expected = [
  '月光馆',
  '杭泺', // 样例图 RapidOCR 结果；肉眼或为「枕泺」
  '九敏啊',
  '冷枞', // 或「冷枫」
  '不加班之主',
  '诺克斯·加缪',
  '栖霜',
  '逍不知道噢', // 首字仍可能缺
  '小羊不吃葱',
]

console.log('rapid available', await isRapidOcrAvailable())
const { candidates, provider, tip } = await recognizeMemberScreenshots([fs.readFileSync(img)])
console.log('provider', provider)
console.log('tip', tip)
console.log('rows', candidates.length)
let okNames = 0
for (const c of candidates) {
  const hit = expected.includes(c.characterName)
  if (hit) okNames += 1
  console.log(
    [
      c.characterName || '(空)',
      c.level || '-',
      c.title,
      c.pathway,
      c.powerScore,
      c.fashionScore,
      hit ? 'OK' : 'CHECK',
    ].join(' | '),
  )
}
console.log(`name exact ${okNames}/${candidates.length}`)
if (candidates.length < 8) {
  console.error('FAIL: expected >=8 rows')
  process.exit(1)
}
if (provider.startsWith('rapidocr') && okNames < 5) {
  console.error('FAIL: RapidOCR name accuracy too low')
  process.exit(1)
}
console.log('OK')
