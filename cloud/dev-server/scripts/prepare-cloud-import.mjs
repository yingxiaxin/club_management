/**
 * 把本地 members.json 转成云控制台可导入格式，并（若已配密钥）直接写入云库。
 *
 * 用法：
 *   node scripts/prepare-cloud-import.mjs          # 只生成导入 JSON
 *   node scripts/prepare-cloud-import.mjs --upload # 配齐 CLOUDBASE_* 后上传
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const src = path.resolve(root, 'data/members.json')
const out = path.resolve(root, 'data/members-cloud-import.json')

// load .env
try {
  const envFile = path.resolve(root, '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
} catch {
  /* ignore */
}

if (!fs.existsSync(src)) {
  console.error('找不到 data/members.json，请先在管理端产生本地成员数据')
  process.exit(1)
}

const rows = JSON.parse(fs.readFileSync(src, 'utf8'))
// 控制台/脚本导入一律写成在职；勿把本地历史 left 带进云库
const cloudRows = rows.map((m) => {
  const { id, status: _status, ...rest } = m
  return {
    _id: id,
    ...rest,
    level: Number(m.level) || 0,
    status: 'active',
  }
})

// 云控制台要求 JSON Lines（每行一个对象），不是 JSON 数组
const jsonl = cloudRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
fs.writeFileSync(out, jsonl, 'utf8')
const outJsonl = path.resolve(root, 'data/members-cloud-import.jsonl')
fs.writeFileSync(outJsonl, jsonl, 'utf8')
console.log(`已生成: ${out}`)
console.log(`已生成: ${outJsonl}`)
console.log(`共 ${cloudRows.length} 条（全部 status=active）`)
console.log('')
console.log('【方式 A · 控制台导入】云开发 → 数据库 → members → 导入')
console.log('  选 members-cloud-import.json 或 .jsonl（均为 JSON Lines，每行一条）')
console.log('【方式 B · 脚本上传】在 .env 配好 CLOUDBASE_SECRET_ID/KEY 后执行：')
console.log('  node scripts/prepare-cloud-import.mjs --upload')

if (!process.argv.includes('--upload')) process.exit(0)

const { loadEnvDefaultsFromRepo, importFromLocalFile, isCloudMembersConfigured } = await import(
  '../src/cloudMembers.js'
)
loadEnvDefaultsFromRepo()
if (!isCloudMembersConfigured()) {
  console.error('未配置 CLOUDBASE_ENV / CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY，无法上传')
  process.exit(1)
}
const result = await importFromLocalFile(src)
console.log('上传完成:', result)
