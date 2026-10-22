/**
 * 清空云库 members 集合（需 .env 配齐 CLOUDBASE_*）。
 * 用法：node scripts/clear-cloud-members.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tcb from '@cloudbase/node-sdk'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

const { CLOUDBASE_ENV, CLOUDBASE_SECRET_ID, CLOUDBASE_SECRET_KEY } = process.env
if (!CLOUDBASE_ENV || !CLOUDBASE_SECRET_ID || !CLOUDBASE_SECRET_KEY) {
  console.error('缺少 CLOUDBASE_ENV / SECRET_ID / SECRET_KEY')
  process.exit(1)
}

const db = tcb
  .init({
    env: CLOUDBASE_ENV,
    secretId: CLOUDBASE_SECRET_ID,
    secretKey: CLOUDBASE_SECRET_KEY,
  })
  .database()

let removed = 0
for (;;) {
  const res = await db.collection('members').limit(100).get()
  const rows = res.data || []
  if (!rows.length) break
  for (const row of rows) {
    await db.collection('members').doc(row._id).remove()
    removed += 1
  }
  if (rows.length < 100) break
}
console.log(`已清空 members，删除 ${removed} 条`)
