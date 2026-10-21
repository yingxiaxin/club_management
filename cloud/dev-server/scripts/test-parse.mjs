import { parseMemberListText } from '../src/ocr/parseMemberList.js'

const sample = `
j 光 馆 会 长 70 战 士 151232 29582 65 未 分 组 31 天 在 线
t 油 外 交 官 70 学 徒 156554 19670 50 未 分 组 7 天 在 线
L 继 啊 俱 乐 部 之 星 70 观 众 172217 148293 70 未 分 组 7 天 在 线
$ 松 正 式 会 员 70 战 士 180456 39505 70 未 分 组 9 天 在 线
“ 加 班 之 主 正 式 会 员 70 占 卜 家 165520 12530 70 未 分 组 30 天 在 线
咤 克 斯 . 加 缪 正 式 会 员 70 - 占 卜 家 164254 128748 70 未 分 组 15 天 在 线
箭 正 式 会 员 70 占 卜 家 162324 55591 70 未 分 组 3 天 在 线
魉 不 知 道 唉 正 式 会 员 70 | 观 众 161510 13435 50 未 分 组 23 天 在 线
\\ 羊 不 吃 葱 正 式 会 员 70 窥 秘 人 154870 11170 45 未 分 组 29 天 在 线
`

const noisy = `
3 瓶 九 敏 啊 佬 乐 部 之 星 70 观 众 172217 148293 70 未 分 组 7 天 在 线
4 识 枝 IE 式 会 员 70 战 士 180456 39505 70 未 分 组 9 天 在 线
5 . 警 “ 不 加 班 之 主 正 式 会 员 70 占 卜 宾 165520 12530 70 未 分 组 30 天 在 线
`

function assertPowers(rows, expected, label) {
  const powers = rows.map((r) => r.powerScore)
  if (JSON.stringify(powers) !== JSON.stringify(expected)) {
    console.error(`FAIL ${label}: powers`, powers, 'expected', expected)
    process.exit(1)
  }
}

const rows = parseMemberListText(sample)
console.log('clean count', rows.length)
assertPowers(
  rows,
  [151232, 156554, 172217, 180456, 165520, 164254, 162324, 161510, 154870],
  'clean',
)

const noisyRows = parseMemberListText(noisy)
console.log('noisy count', noisyRows.length)
for (const r of noisyRows) {
  console.log(`${r.characterName} | ${r.title} | ${r.pathway} | ${r.powerScore} | ${r.fashionScore}`)
}
if (noisyRows.length !== 3) {
  console.error('FAIL noisy: expected 3 rows')
  process.exit(1)
}
assertPowers(noisyRows, [172217, 180456, 165520], 'noisy')
const names = noisyRows.map((r) => r.characterName)
if (!names.some((n) => n.includes('九敏') || n.includes('敏啊'))) {
  console.error('FAIL noisy: missing 九敏啊-like name', names)
  process.exit(1)
}
if (!names.some((n) => n.includes('不加班'))) {
  console.error('FAIL noisy: missing 不加班之主', names)
  process.exit(1)
}
console.log('OK')
