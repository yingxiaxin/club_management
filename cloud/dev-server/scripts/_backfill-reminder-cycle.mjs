/**
 * 回填缺 reminderCycle、但已有提前量的旧活动
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tcb from '@cloudbase/node-sdk'

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i <= 0) continue
  const k = t.slice(0, i).trim()
  let v = t.slice(i + 1).trim()
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1)
  }
  if (process.env[k] === undefined) process.env[k] = v
}

const cloudMembers = await import('../src/cloudMembers.js')
cloudMembers.loadEnvDefaultsFromRepo()

const app = tcb.init({
  env: process.env.CLOUDBASE_ENV,
  secretId: process.env.CLOUDBASE_SECRET_ID,
  secretKey: process.env.CLOUDBASE_SECRET_KEY,
})
const db = app.database()

function infer(row) {
  if (row.reminderCycle) return null
  if (!Array.isArray(row.reminderOffsetsMinutes) || !row.reminderOffsetsMinutes.length) {
    return null
  }
  let s = row.startSchedule
  if ((!s || !s.time) && row.startAt) {
    const d = new Date(row.startAt)
    if (!Number.isNaN(d.getTime())) {
      const wd = d.getDay()
      s = {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        weekday: wd === 0 ? 7 : wd,
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      }
    }
  }
  if (!s?.time) return null
  const full = s.year != null && s.month != null && s.day != null
  if (full) return 'once'
  if (s.day != null) return 'once'
  if (s.weekday != null) return 'weekly'
  return 'daily'
}

const pageSize = 100
let offset = 0
let patched = 0
for (;;) {
  const res = await db.collection('activities').skip(offset).limit(pageSize).get()
  const rows = res.data || []
  for (const row of rows) {
    const cycle = infer(row)
    if (!cycle) continue
    await db.collection('activities').doc(row._id).update({
      reminderCycle: cycle,
      updatedAt: new Date().toISOString(),
    })
    patched += 1
    console.log('patched', row._id, row.title, '→', cycle)
  }
  if (rows.length < pageSize) break
  offset += pageSize
}
console.log('done, patched', patched)
