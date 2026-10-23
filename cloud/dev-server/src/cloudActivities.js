/**
 * 云库 activities（管理端本机 API · P1-a）
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const ACTIVITIES = 'activities'

const ACTIVITY_TYPES = new Set(['daily', 'weekly', 'pvp', 'custom'])
const ACTIVITY_STATUSES = new Set(['draft', 'published', 'ongoing', 'ended', 'cancelled'])
const REMINDER_CYCLES = new Set(['none', 'once', 'daily', 'weekly', 'monthly'])

let app = null
let collectionsReady = false

function getDb() {
  if (!cloudMembers.isCloudMembersConfigured()) {
    throw Object.assign(new Error('未配置云开发密钥'), { status: 500 })
  }
  if (!app) {
    app = tcb.init({
      env: process.env.CLOUDBASE_ENV,
      secretId: process.env.CLOUDBASE_SECRET_ID,
      secretKey: process.env.CLOUDBASE_SECRET_KEY,
    })
  }
  return app.database()
}

async function ensureCollection(name) {
  const db = getDb()
  try {
    const res = await db.createCollection(name)
    if (res && res.code && !/exist|已存在|RESOURCE_EXIST/i.test(String(res.code + res.message))) {
      console.warn('[cloudActivities] createCollection', name, res.code, res.message)
    }
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudActivities] createCollection', name, msg)
    }
  }
}

export async function ensureActivityCollections() {
  if (collectionsReady) return
  await ensureCollection(ACTIVITIES)
  collectionsReady = true
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

async function fetchAll(collection) {
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await database.collection(collection).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all.map(toClient)
}

function normalizeOffsets(raw, fallback = [10]) {
  if (raw === null) return null
  if (raw === undefined) return fallback.slice()
  if (!Array.isArray(raw)) return fallback.slice()
  const nums = raw
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n))
  return nums.length ? [...new Set(nums)].sort((a, b) => a - b) : fallback.slice()
}

function normalizeType(type) {
  const t = String(type || 'custom').trim()
  if (!ACTIVITY_TYPES.has(t)) throw err('活动类型无效', 400)
  return t
}

/** @returns {{ year:number|null, month:number|null, day:number|null, weekday:number|null, time:string|null }} */
function normalizeSchedule(raw, { required = false, label = '开始' } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const toInt = (v) => {
    if (v === '' || v === undefined || v === null) return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : NaN
  }
  const year = toInt(src.year)
  const month = toInt(src.month)
  const day = toInt(src.day)
  const weekday = toInt(src.weekday)
  let time = src.time == null || src.time === '' ? null : String(src.time).trim()
  if (time) {
    const m = time.match(/^(\d{1,2}):(\d{2})$/)
    if (!m) throw err(`${label}时间格式须为 HH:mm`, 400)
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) throw err(`${label}时间无效`, 400)
    time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  if (year != null && (Number.isNaN(year) || year < 2000 || year > 2100)) {
    throw err(`${label}年份无效`, 400)
  }
  if (month != null && (Number.isNaN(month) || month < 1 || month > 12)) {
    throw err(`${label}月份无效`, 400)
  }
  if (day != null && (Number.isNaN(day) || day < 1 || day > 31)) {
    throw err(`${label}日期无效`, 400)
  }
  if (weekday != null && (Number.isNaN(weekday) || weekday < 1 || weekday > 7)) {
    throw err(`${label}星期无效（1=周一…7=周日）`, 400)
  }

  const schedule = {
    year: year != null && !Number.isNaN(year) ? year : null,
    month: month != null && !Number.isNaN(month) ? month : null,
    day: day != null && !Number.isNaN(day) ? day : null,
    weekday: weekday != null && !Number.isNaN(weekday) ? weekday : null,
    time,
  }
  const hasAny =
    schedule.year != null ||
    schedule.month != null ||
    schedule.day != null ||
    schedule.weekday != null ||
    Boolean(schedule.time)
  if (required && !hasAny) {
    throw err(`请填写${label}的年月日、时间或星期几（至少一项）`, 400)
  }
  if (!hasAny) return null
  return schedule
}

function scheduleFromIso(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const wd = d.getDay()
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: wd === 0 ? 7 : wd,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  }
}

function isoFromSchedule(schedule) {
  if (!schedule?.time || schedule.year == null || schedule.month == null || schedule.day == null) {
    return null
  }
  const [h, m] = schedule.time.split(':').map(Number)
  const d = new Date(schedule.year, schedule.month - 1, schedule.day, h, m, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * 根据开始日程分量，决定可选提醒周期：
 * - 无时间 → none
 * - 年月日+时间 → 仅 once
 * - 日+时间 → once | daily
 * - 周几+时间 → once | weekly
 * - 仅时间 → daily
 */
export function allowedReminderCycles(schedule) {
  if (!schedule?.time) return ['none']
  const full =
    schedule.year != null && schedule.month != null && schedule.day != null
  if (full) return ['once']

  const opts = []
  const push = (c) => {
    if (!opts.includes(c)) opts.push(c)
  }
  if (schedule.day != null) {
    push('once')
    push('daily')
  }
  if (schedule.weekday != null) {
    push('once')
    push('weekly')
  }
  if (opts.length) return opts
  return ['daily']
}

function normalizeReminderCycle(cycle, schedule) {
  const allowed = allowedReminderCycles(schedule)
  if (!schedule?.time) return 'none'
  const c = String(cycle || '').trim()
  if (REMINDER_CYCLES.has(c) && allowed.includes(c)) return c
  return allowed[0] || 'none'
}

function resolveSchedules(payload) {
  let startRaw = payload.startSchedule
  if (!startRaw && payload.startAt) startRaw = scheduleFromIso(payload.startAt)
  const startSchedule = normalizeSchedule(startRaw, { required: true, label: '开始' })

  let endSchedule = null
  if (payload.endSchedule !== undefined) {
    endSchedule = normalizeSchedule(payload.endSchedule, { required: false, label: '结束' })
  } else if (payload.endAt) {
    endSchedule = normalizeSchedule(scheduleFromIso(payload.endAt), {
      required: false,
      label: '结束',
    })
  }

  const reminderCycle = normalizeReminderCycle(payload.reminderCycle, startSchedule)
  let reminderOffsetsMinutes = []
  if (reminderCycle !== 'none') {
    reminderOffsetsMinutes = normalizeOffsets(payload.reminderOffsetsMinutes, [10])
  }

  return {
    startSchedule,
    endSchedule,
    reminderCycle,
    reminderOffsetsMinutes,
    startAt: isoFromSchedule(startSchedule),
    endAt: endSchedule ? isoFromSchedule(endSchedule) : null,
  }
}

export async function listActivities({ status, from, to, q } = {}) {
  await ensureActivityCollections()
  let list = await fetchAll(ACTIVITIES)
  if (status) list = list.filter((a) => a.status === status)
  if (from) {
    const t = new Date(from).getTime()
    if (!Number.isNaN(t)) {
      list = list.filter((a) => a.startAt && new Date(a.startAt).getTime() >= t)
    }
  }
  if (to) {
    const t = new Date(to).getTime()
    if (!Number.isNaN(t)) {
      list = list.filter((a) => a.startAt && new Date(a.startAt).getTime() <= t)
    }
  }
  if (q) {
    const key = String(q).trim().toLowerCase()
    list = list.filter(
      (a) =>
        (a.title || '').toLowerCase().includes(key) ||
        (a.description || '').toLowerCase().includes(key),
    )
  }
  list.sort((a, b) => {
    const at = a.startAt
      ? new Date(a.startAt).getTime()
      : a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0
    const bt = b.startAt
      ? new Date(b.startAt).getTime()
      : b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0
    return bt - at
  })
  return list
}

export async function getActivity(id) {
  await ensureActivityCollections()
  try {
    const res = await getDb().collection(ACTIVITIES).doc(String(id)).get()
    return toClient(Array.isArray(res.data) ? res.data[0] : res.data)
  } catch {
    return null
  }
}

export async function createActivity(payload = {}, createdBy = 'admin') {
  await ensureActivityCollections()

  const title = String(payload.title || '').trim()
  if (!title) throw err('标题不能为空', 400)

  const type = normalizeType(payload.type || 'custom')
  const sched = resolveSchedules(payload)

  if (
    sched.startAt &&
    sched.endAt &&
    new Date(sched.endAt).getTime() < new Date(sched.startAt).getTime()
  ) {
    throw err('结束时间不能早于开始时间', 400)
  }

  const enableTeam = Boolean(payload.enableTeam)

  let status = String(payload.status || 'draft')
  if (!ACTIVITY_STATUSES.has(status)) throw err('状态无效', 400)
  if (!['draft', 'published'].includes(status)) {
    throw err('新建仅支持 draft 或 published', 400)
  }

  const now = new Date().toISOString()
  const id = `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const row = {
    title,
    type,
    startSchedule: sched.startSchedule,
    endSchedule: sched.endSchedule,
    startAt: sched.startAt,
    endAt: sched.endAt,
    description: String(payload.description || '').trim(),
    enableTeam,
    reminderCycle: sched.reminderCycle,
    reminderOffsetsMinutes: sched.reminderOffsetsMinutes,
    status,
    createdBy: String(createdBy || 'admin'),
    createdAt: now,
    updatedAt: now,
  }
  await getDb().collection(ACTIVITIES).doc(id).set(row)
  return { id, ...row }
}

export async function updateActivity(id, payload = {}) {
  await ensureActivityCollections()
  const row = await getActivity(id)
  if (!row) throw err('活动不存在', 404)
  if (row.status === 'cancelled') throw err('已取消的活动不可编辑', 409)
  if (row.status === 'ended') throw err('已结束的活动不可编辑', 409)

  const patch = { updatedAt: new Date().toISOString() }

  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim()
    if (!title) throw err('标题不能为空', 400)
    patch.title = title
  }
  if (payload.type !== undefined) patch.type = normalizeType(payload.type)
  if (payload.description !== undefined) {
    patch.description = String(payload.description || '').trim()
  }
  if (payload.enableTeam !== undefined) patch.enableTeam = Boolean(payload.enableTeam)

  const touchSchedule =
    payload.startSchedule !== undefined ||
    payload.endSchedule !== undefined ||
    payload.startAt !== undefined ||
    payload.endAt !== undefined ||
    payload.reminderCycle !== undefined ||
    payload.reminderOffsetsMinutes !== undefined

  if (touchSchedule) {
    const merged = {
      startSchedule: payload.startSchedule !== undefined ? payload.startSchedule : row.startSchedule,
      endSchedule: payload.endSchedule !== undefined ? payload.endSchedule : row.endSchedule,
      startAt:
        payload.startAt !== undefined
          ? payload.startAt
          : payload.startSchedule !== undefined
            ? undefined
            : row.startAt,
      endAt:
        payload.endAt !== undefined
          ? payload.endAt
          : payload.endSchedule !== undefined
            ? undefined
            : row.endAt,
      reminderCycle: payload.reminderCycle !== undefined ? payload.reminderCycle : row.reminderCycle,
      reminderOffsetsMinutes:
        payload.reminderOffsetsMinutes !== undefined
          ? payload.reminderOffsetsMinutes
          : row.reminderOffsetsMinutes,
    }
    // 旧数据无 startSchedule 时从 startAt 还原
    if (!merged.startSchedule && merged.startAt) {
      merged.startSchedule = scheduleFromIso(merged.startAt)
    }
    if (merged.endSchedule === undefined && merged.endAt) {
      merged.endSchedule = scheduleFromIso(merged.endAt)
    }
    const sched = resolveSchedules(merged)
    if (
      sched.startAt &&
      sched.endAt &&
      new Date(sched.endAt).getTime() < new Date(sched.startAt).getTime()
    ) {
      throw err('结束时间不能早于开始时间', 400)
    }
    patch.startSchedule = sched.startSchedule
    patch.endSchedule = sched.endSchedule
    patch.startAt = sched.startAt
    patch.endAt = sched.endAt
    patch.reminderCycle = sched.reminderCycle
    patch.reminderOffsetsMinutes = sched.reminderOffsetsMinutes
  }

  await getDb().collection(ACTIVITIES).doc(String(id)).update(patch)
  return { ...row, ...patch }
}

/**
 * 状态流转：publish | cancel | start | end
 * 管理端常用 publish / cancel；start/end 供后续定时或手点
 */
export async function transitionActivity(id, action) {
  await ensureActivityCollections()
  const row = await getActivity(id)
  if (!row) throw err('活动不存在', 404)

  const map = {
    publish: { from: ['draft'], to: 'published' },
    cancel: { from: ['draft', 'published', 'ongoing'], to: 'cancelled' },
    start: { from: ['published'], to: 'ongoing' },
    end: { from: ['published', 'ongoing'], to: 'ended' },
  }
  const rule = map[String(action || '')]
  if (!rule) throw err('未知操作，支持 publish/cancel/start/end', 400)
  if (!rule.from.includes(row.status)) {
    throw err(`当前状态 ${row.status} 不能执行 ${action}`, 409)
  }

  const patch = {
    status: rule.to,
    updatedAt: new Date().toISOString(),
  }
  await getDb().collection(ACTIVITIES).doc(String(id)).update(patch)

  // P2：活动结束/取消 → 下属招募中队伍强制关闭
  if (rule.to === 'ended' || rule.to === 'cancelled') {
    try {
      const { closeTeamsForActivity } = await import('./cloudTeams.js')
      await closeTeamsForActivity(id)
    } catch (e) {
      console.warn('[cloudActivities] closeTeamsForActivity', e?.message || e)
    }
  }

  return { ...row, ...patch }
}
