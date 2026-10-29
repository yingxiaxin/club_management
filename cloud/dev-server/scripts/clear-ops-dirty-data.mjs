/**
 * 物理清空：公告、邀请码、活动链路、队伍、出勤实到（及活动订阅/提醒去重）。
 * 不动：members / users / club_profile / gallery_* / join_applications / ocr_jobs
 *
 * 用法：node scripts/clear-ops-dirty-data.mjs
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

/** 依赖顺序：先清挂靠文档，再清主表 */
const COLLECTIONS = [
  'team_applications',
  'teams',
  'activity_attendance',
  'activity_rsvps',
  'activity_rsvp_snapshots',
  'subscriptions',
  'reminder_jobs',
  'activities',
  'announcements',
  'invite_codes',
]

const db = tcb
  .init({
    env: CLOUDBASE_ENV,
    secretId: CLOUDBASE_SECRET_ID,
    secretKey: CLOUDBASE_SECRET_KEY,
  })
  .database()

async function clearCollection(name) {
  let removed = 0
  for (;;) {
    let rows = []
    try {
      const res = await db.collection(name).limit(100).get()
      rows = res.data || []
    } catch (err) {
      const msg = String(err?.message || err)
      if (/COLLECTION_NOT_EXIST|ResourceNotFound|not exist/i.test(msg)) {
        return { removed: 0, missing: true }
      }
      throw err
    }
    if (!rows.length) break
    for (const row of rows) {
      await db.collection(name).doc(row._id).remove()
      removed += 1
    }
    if (rows.length < 100) break
  }
  return { removed, missing: false }
}

console.log(`目标环境：${CLOUDBASE_ENV}`)
console.log(`将物理删除集合：${COLLECTIONS.join(', ')}`)

const summary = []
for (const name of COLLECTIONS) {
  const { removed, missing } = await clearCollection(name)
  if (missing) {
    console.log(`[跳过] ${name}（集合不存在）`)
    summary.push({ name, removed: 0, missing: true })
  } else {
    console.log(`[完成] ${name}：删除 ${removed} 条`)
    summary.push({ name, removed, missing: false })
  }
}

const total = summary.reduce((n, x) => n + x.removed, 0)
console.log(`合计删除 ${total} 条`)
