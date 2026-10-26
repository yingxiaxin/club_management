/**
 * 定时扫描：向已「提醒我」的成员发送订阅消息。
 * 触发：云函数定时器每分钟；亦可手动 callFunction({ name:'reminderDispatch' })
 *
 * 依赖 club_profile.subscribeTemplateId；未配置则只记 skip。
 * 模板字段约定（当前「活动集合通知」67212）：
 * thing1=活动名称，time3=集合时间，thing5=备注（换模板时改下方 data map）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ACTIVITIES = 'activities'
const CLUB = 'club_profile'
const SUBS = 'subscriptions'
const JOBS = 'reminder_jobs'
const CLUB_ID = 'club_main'
const VISIBLE = new Set(['published', 'ongoing'])

// 复用 memberApi 日程匹配（同仓相对路径在云端上传时需把 scheduleMatch 一并带上）
// 为降低部署耦合，此处内联精简版 start 解析
function shanghaiParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const hour = String(parts.hour === '24' ? '00' : parts.hour).padStart(2, '0')
  const minute = String(parts.minute || '0').padStart(2, '0')
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday] || 1,
    time: `${hour}:${minute}`,
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function shanghaiDateTimeMs(year, month, day, time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(Number(m[1]))}:${m[2]}:00+08:00`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function resolveStartSchedule(activity) {
  const s = activity?.startSchedule
  if (s && typeof s === 'object') {
    const hasAny =
      s.year != null ||
      s.month != null ||
      s.day != null ||
      s.weekday != null ||
      Boolean(s.time)
    if (hasAny) {
      return {
        year: s.year ?? null,
        month: s.month ?? null,
        day: s.day ?? null,
        weekday: s.weekday ?? null,
        time: s.time || null,
      }
    }
  }
  if (!activity?.startAt) return null
  return shanghaiParts(new Date(activity.startAt))
}

function matchesCalendarDay(activity, dayParts) {
  const schedule = resolveStartSchedule(activity)
  if (!schedule) return false
  const fullDate =
    schedule.year != null && schedule.month != null && schedule.day != null
  if (fullDate || activity.startAt) {
    const abs = fullDate
      ? schedule
      : shanghaiParts(new Date(activity.startAt))
    return (
      abs.year === dayParts.year &&
      abs.month === dayParts.month &&
      abs.day === dayParts.day
    )
  }
  if (schedule.year != null && schedule.year !== dayParts.year) return false
  if (schedule.month != null && schedule.month !== dayParts.month) return false
  if (schedule.day != null && schedule.day !== dayParts.day) return false
  if (schedule.weekday != null && schedule.weekday !== dayParts.weekday) return false
  return true
}

function resolveRelevantStartMs(activity, now = new Date()) {
  const schedule = resolveStartSchedule(activity)
  if (!schedule) return null
  if (activity.startAt) {
    const t = new Date(activity.startAt).getTime()
    return Number.isNaN(t) ? null : t
  }
  if (
    schedule.year != null &&
    schedule.month != null &&
    schedule.day != null &&
    schedule.time
  ) {
    return shanghaiDateTimeMs(schedule.year, schedule.month, schedule.day, schedule.time)
  }
  if (!schedule.time) return null
  const today = shanghaiParts(now)
  const noonUtc = Date.UTC(today.year, today.month - 1, today.day, 4, 0, 0)
  const candidates = []
  for (let i = 0; i < 7; i++) {
    const day = shanghaiParts(new Date(noonUtc + i * 86400000))
    if (!matchesCalendarDay(activity, day)) continue
    const ms = shanghaiDateTimeMs(day.year, day.month, day.day, schedule.time)
    if (ms != null) candidates.push(ms)
  }
  if (!candidates.length) return null
  const nowMs = now.getTime()
  const future = candidates.filter((t) => t >= nowMs).sort((a, b) => a - b)
  if (future.length) return future[0]
  return Math.max(...candidates)
}

/** 微信 time.* 字段常用格式：yyyy年MM月dd日 HH:mm（勿夹「周一」等非标准片段） */
function formatStartText(activity) {
  const ms = resolveRelevantStartMs(activity)
  if (ms != null) {
    const p = shanghaiParts(new Date(ms))
    return `${p.year}年${pad2(p.month)}月${pad2(p.day)}日 ${p.time}`
  }
  const s = resolveStartSchedule(activity)
  if (!s) return '时间待定'
  if (s.time) return s.time
  return '时间待定'
}

function truncate(str, max) {
  const s = String(str || '')
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function db() {
  return cloud.database()
}

async function ensure(name) {
  try {
    await db().createCollection(name)
  } catch {
    /* exist ok */
  }
}

async function getClub() {
  try {
    const res = await db().collection(CLUB).doc(CLUB_ID).get()
    return res.data || {}
  } catch {
    return {}
  }
}

async function fetchActivities() {
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db().collection(ACTIVITIES).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows.map((d) => ({ id: d._id, ...d })))
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all.filter(
    (a) => VISIBLE.has(a.status) && a.reminderCycle && a.reminderCycle !== 'none',
  )
}

async function listSubs(activityId) {
  const res = await db()
    .collection(SUBS)
    .where({ activityId: String(activityId), status: 'active' })
    .limit(100)
    .get()
  // 同一 openid 多条时只保留一条，避免同一次扫描连发
  const byOpenid = new Map()
  for (const d of res.data || []) {
    const openid = String(d.openid || '')
    if (!openid || byOpenid.has(openid)) continue
    byOpenid.set(openid, { id: d._id, ...d })
  }
  return [...byOpenid.values()]
}

function resolveOffsets(_activity, clubOffsets) {
  const allowed = new Set([5, 10, 15, 30, 60, 120])
  const pick = (arr, fb) => {
    const nums = [
      ...new Set(
        (arr || [])
          .map((n) => Number(n))
          .filter((n) => allowed.has(n)),
      ),
    ].sort((a, b) => a - b)
    return nums.length ? nums : fb
  }
  // 提前量一律俱乐部提醒设置（活动字段忽略）
  return pick(clubOffsets, [10])
}

/** 必须用 set：云库对不存在文档的 update 常返回 updated:0 且不抛错，去重会失效导致连发 */
async function markJob(jobId, patch) {
  const now = new Date().toISOString()
  let createdAt = now
  try {
    const prev = await db().collection(JOBS).doc(jobId).get()
    if (prev.data?.createdAt) createdAt = prev.data.createdAt
  } catch {
    /* 新文档 */
  }
  await db()
    .collection(JOBS)
    .doc(jobId)
    .set({
      data: {
        ...patch,
        createdAt,
        updatedAt: patch.updatedAt || now,
      },
    })
}

async function alreadySent(jobId) {
  try {
    const res = await db().collection(JOBS).doc(jobId).get()
    const row = res.data
    // sending：上一轮已占坑，避免窗口内（约 2 分钟）定时器连跑重复发
    return (
      row &&
      (row.status === 'sent' ||
        row.status === 'skipped_no_template' ||
        row.status === 'sending')
    )
  } catch {
    return false
  }
}

exports.main = async () => {
  const now = new Date()
  const nowMs = now.getTime()
  // 窗口：已到期且不超过 2 分钟，避免漏发/重复
  const windowMs = 2 * 60 * 1000

  await Promise.all([ensure(SUBS), ensure(JOBS)])

  const club = await getClub()
  const templateId = String(club.subscribeTemplateId || '').trim()
  const miniprogramState = ['developer', 'trial', 'formal'].includes(
    club.subscribeMiniprogramState,
  )
    ? club.subscribeMiniprogramState
    : 'developer'
  const clubOffsets = Array.isArray(club.reminderOffsetsMinutes)
    ? club.reminderOffsetsMinutes
    : [10]

  const activities = await fetchActivities()
  const summary = { scanned: activities.length, due: 0, sent: 0, failed: 0, skipped: 0 }

  for (const activity of activities) {
    const startMs = resolveRelevantStartMs(activity, now)
    if (startMs == null || startMs <= nowMs) continue
    const offsets = resolveOffsets(activity, clubOffsets)
    const subs = await listSubs(activity.id)
    if (!subs.length) continue

    for (const offset of offsets) {
      const fireAt = startMs - offset * 60 * 1000
      if (fireAt > nowMs || nowMs - fireAt > windowMs) continue
      summary.due += subs.length

      for (const sub of subs) {
        const fireKey = new Date(fireAt).toISOString()
        const jobId = `${activity.id}__${sub.openid}__${offset}`
        if (await alreadySent(jobId)) {
          summary.skipped += 1
          continue
        }

        if (!templateId) {
          await markJob(jobId, {
            activityId: activity.id,
            openid: sub.openid,
            offsetMinutes: offset,
            fireAt: fireKey,
            status: 'skipped_no_template',
          })
          summary.skipped += 1
          continue
        }

        // 先占坑再发送，缩小「已发但未记账」导致下一分钟再发的窗口
        await markJob(jobId, {
          activityId: activity.id,
          openid: sub.openid,
          offsetMinutes: offset,
          fireAt: fireKey,
          status: 'sending',
        })

        try {
          await cloud.openapi.subscribeMessage.send({
            touser: sub.openid,
            templateId,
            page: `pages/activity-detail/index?id=${activity.id}`,
            miniprogramState,
            data: {
              thing1: { value: truncate(activity.title || '俱乐部活动', 20) },
              time3: { value: formatStartText(activity) },
              thing5: { value: truncate(`将于 ${offset} 分钟后开始`, 20) },
            },
          })
          await markJob(jobId, {
            activityId: activity.id,
            openid: sub.openid,
            offsetMinutes: offset,
            fireAt: fireKey,
            status: 'sent',
            sentAt: new Date().toISOString(),
          })
          summary.sent += 1
        } catch (e) {
          console.error('[reminderDispatch] send fail', activity.id, sub.openid, e)
          await markJob(jobId, {
            activityId: activity.id,
            openid: sub.openid,
            offsetMinutes: offset,
            fireAt: fireKey,
            status: 'failed',
            error: String(e.message || e).slice(0, 200),
          })
          summary.failed += 1
        }
      }
    }
  }

  return { ok: true, data: summary, templateConfigured: Boolean(templateId) }
}
