/**
 * 场次实到 activity_attendance（P3-board-b）
 * 约定：docs/P3出勤与个人中心.md §2.2
 */
import tcb from '@cloudbase/node-sdk'
import { createRequire } from 'module'
import * as cloudMembers from './cloudMembers.js'
import * as cloudActivities from './cloudActivities.js'
import * as cloudRsvps from './cloudRsvps.js'

const require = createRequire(import.meta.url)
const { resolveOccurrence } = require('../../functions/memberApi/scheduleMatch.js')

const ATTENDANCE = 'activity_attendance'
const SNAPSHOTS = 'activity_rsvp_snapshots'
const RSVPS = 'activity_rsvps'
const RSVP_STATUSES = new Set(['going', 'maybe', 'decline'])

let app = null
let collectionReady = false

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

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function attendanceDocId(activityId, dateKey) {
  return `${String(activityId)}__${String(dateKey)}`
}

function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addCalendarDays(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d + delta)
  const x = new Date(ms)
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}

async function ensureAttendanceCollection() {
  if (collectionReady) return
  const db = getDb()
  try {
    const res = await db.createCollection(ATTENDANCE)
    if (res && res.code && !/exist|已存在|RESOURCE_EXIST/i.test(String(res.code + res.message))) {
      console.warn('[cloudAttendance] createCollection', res.code, res.message)
    }
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudAttendance] createCollection', msg)
    }
  }
  collectionReady = true
}

async function fetchAll(collection, where = null) {
  const db = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    let query = db.collection(collection)
    if (where) query = query.where(where)
    const res = await query.skip(offset).limit(pageSize).get()
    const rows = (res.data || []).map(toClient)
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

export async function getAttendanceDoc(activityId, dateKey) {
  await ensureAttendanceCollection()
  const id = attendanceDocId(activityId, dateKey)
  try {
    const res = await getDb().collection(ATTENDANCE).doc(id).get()
    return toClient(Array.isArray(res.data) ? res.data[0] : res.data)
  } catch {
    return null
  }
}

/** 批量：key = `${activityId}__${dateKey}` → doc */
export async function mapAttendanceByKeys(keys) {
  await ensureAttendanceCollection()
  const uniq = [...new Set((keys || []).map(String).filter(Boolean))]
  const map = new Map()
  await Promise.all(
    uniq.map(async (id) => {
      try {
        const res = await getDb().collection(ATTENDANCE).doc(id).get()
        const row = toClient(Array.isArray(res.data) ? res.data[0] : res.data)
        if (row) map.set(id, row)
      } catch {
        /* skip */
      }
    }),
  )
  return map
}

function resolveDateKey(activity, dateKeyQuery) {
  const q = String(dateKeyQuery || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q
  const occ = resolveOccurrence(activity)
  if (occ?.dateKey) return String(occ.dateKey)
  throw err('缺少场次日 dateKey', 400)
}

function occFlags(activity, now = new Date()) {
  const occ = resolveOccurrence(activity, now)
  return {
    occurrenceDateKey: occ?.dateKey || null,
    occurrenceEnded: Boolean(occ?.ended),
    occurrenceStarted: Boolean(occ?.started),
    canEdit: Boolean(occ?.started || occ?.ended),
  }
}

/**
 * GET 实到：无档时预勾 going；进行中可预勾，已结束可计入统计。
 * 无 RSVP 但已勾实到的人放 extras（补录）。
 */
export async function getAttendance(activityId, dateKeyQuery) {
  const activity = await cloudActivities.getActivity(activityId)
  if (!activity) throw err('活动不存在', 404)
  const dateKey = resolveDateKey(activity, dateKeyQuery)
  const flags = occFlags(activity)
  const people = await cloudRsvps.listLiveRsvpPeople(activityId)
  const goingIds = people.filter((p) => p.status === 'going').map((p) => p.memberId).filter(Boolean)
  const saved = await getAttendanceDoc(activityId, dateKey)
  const presentSet = new Set(
    saved && Array.isArray(saved.presentMemberIds)
      ? saved.presentMemberIds.map(String)
      : goingIds,
  )
  const rows = people.map((p) => ({
    ...p,
    present: presentSet.has(String(p.memberId)),
  }))

  const rsvpIds = new Set(people.map((p) => String(p.memberId || '')).filter(Boolean))
  const extraIds = [...presentSet].filter((id) => !rsvpIds.has(id))
  let extras = []
  if (extraIds.length) {
    const members = await cloudMembers.listMembers({ sort: 'characterName', order: 'asc' })
    const byId = new Map(members.map((m) => [String(m.id), m]))
    extras = extraIds.map((id) => {
      const m = byId.get(id)
      return {
        memberId: id,
        characterName: m?.characterName || id,
        pathway: m?.pathway || '',
        status: '',
        statusLabel: '未报名',
        present: true,
      }
    })
    extras.sort((a, b) =>
      String(a.characterName).localeCompare(String(b.characterName), 'zh-CN'),
    )
  }

  return {
    activityId: String(activityId),
    title: activity.title || '',
    occurrenceDateKey: dateKey,
    occurrenceEnded: flags.occurrenceEnded,
    occurrenceStarted: flags.occurrenceStarted,
    canEdit: flags.canEdit,
    saved: Boolean(saved),
    presentMemberIds: [...presentSet],
    presentCount: presentSet.size,
    goingCount: goingIds.length,
    goingCountAtSave: saved?.goingCountAtSave ?? null,
    updatedAt: saved?.updatedAt || null,
    people: rows,
    extras,
  }
}

export async function putAttendance(activityId, body = {}, operator = '') {
  const activity = await cloudActivities.getActivity(activityId)
  if (!activity) throw err('活动不存在', 404)
  const dateKey = resolveDateKey(activity, body.dateKey)
  const flags = occFlags(activity)
  if (!flags.canEdit) throw err('活动未开始，暂不可点名', 409)

  const rawIds = Array.isArray(body.presentMemberIds) ? body.presentMemberIds : null
  if (!rawIds) throw err('presentMemberIds 须为数组', 400)
  const presentMemberIds = [...new Set(rawIds.map(String).filter(Boolean))]

  const people = await cloudRsvps.listLiveRsvpPeople(activityId)
  const goingCount = people.filter((p) => p.status === 'going').length
  const now = new Date().toISOString()
  const id = attendanceDocId(activityId, dateKey)
  await ensureAttendanceCollection()
  await getDb()
    .collection(ATTENDANCE)
    .doc(id)
    .set({
      activityId: String(activityId),
      occurrenceDateKey: dateKey,
      presentMemberIds,
      goingCountAtSave: goingCount,
      updatedAt: now,
      updatedBy: String(operator || ''),
    })

  return getAttendance(activityId, dateKey)
}

function attendanceBrief(doc) {
  if (!doc) return null
  const presentCount = Array.isArray(doc.presentMemberIds) ? doc.presentMemberIds.length : 0
  const going = doc.goingCountAtSave
  let rateLabel = '—'
  if (typeof going === 'number' && going > 0) {
    rateLabel = `${Math.round((presentCount / going) * 100)}%`
  }
  return {
    saved: true,
    presentCount,
    goingCountAtSave: typeof going === 'number' ? going : null,
    rateLabel,
  }
}

/** 挂到看板卡片上的实到摘要 */
export async function attachAttendanceBriefs(activities) {
  const keys = (activities || [])
    .filter((a) => a.occurrenceDateKey)
    .map((a) => attendanceDocId(a.id, a.occurrenceDateKey))
  const map = await mapAttendanceByKeys(keys)
  return (activities || []).map((a) => {
    if (!a.occurrenceDateKey) return { ...a, attendance: null }
    const doc = map.get(attendanceDocId(a.id, a.occurrenceDateKey))
    return { ...a, attendance: attendanceBrief(doc) }
  })
}

function ensureMemberBucket(byMember, memberId, characterName = '', pathway = '') {
  const id = String(memberId)
  if (!byMember.has(id)) {
    byMember.set(id, {
      memberId: id,
      characterName: characterName || '',
      pathway: pathway || '',
      going: 0,
      maybe: 0,
      decline: 0,
      present: 0,
      total: 0,
      recent: [],
    })
  }
  return byMember.get(id)
}

/**
 * 成员出勤摘要：近 weeks 周 = live RSVP + 快照 + 已保存实到（含未报名补录）
 */
export async function getMemberAttendanceStats({ weeks = 4 } = {}) {
  const w = Math.min(12, Math.max(1, Number(weeks) || 4))
  const today = shanghaiYmd(new Date())
  const cutoff = addCalendarDays(today, -(w * 7 - 1))

  await ensureAttendanceCollection()
  const [snapshots, liveRsvps, activities, attendanceDocs] = await Promise.all([
    fetchAll(SNAPSHOTS).catch(() => []),
    fetchAll(RSVPS).catch(() => []),
    cloudActivities.listActivities(),
    fetchAll(ATTENDANCE).catch(() => []),
  ])
  const activityMap = new Map(activities.map((a) => [String(a.id), a]))

  /** @type {{ activityId:string, title:string, dateKey:string, memberId:string, characterName:string, pathway:string, status:string }[]} */
  const slots = []

  for (const snap of snapshots) {
    const dateKey = String(snap.occurrenceDateKey || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < cutoff) continue
    const aid = String(snap.activityId || '')
    const title = activityMap.get(aid)?.title || aid
    for (const row of snap.rows || []) {
      if (!RSVP_STATUSES.has(row.status)) continue
      const mid = String(row.memberId || '')
      if (!mid) continue
      slots.push({
        activityId: aid,
        title,
        dateKey,
        memberId: mid,
        characterName: row.characterName || '',
        pathway: row.pathway || '',
        status: row.status,
      })
    }
  }

  const liveByActivity = new Map()
  for (const row of liveRsvps) {
    if (!RSVP_STATUSES.has(row.status)) continue
    const aid = String(row.activityId || '')
    if (!liveByActivity.has(aid)) liveByActivity.set(aid, [])
    liveByActivity.get(aid).push(row)
  }

  for (const [aid, rows] of liveByActivity) {
    const act = activityMap.get(aid)
    if (!act) continue
    const occ = resolveOccurrence(act)
    const dateKey = occ?.dateKey ? String(occ.dateKey) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < cutoff) continue
    // 若该场次已有快照，跳过 live，避免重复
    if (
      snapshots.some(
        (s) =>
          String(s.id) === `${aid}__${dateKey}` ||
          (String(s.activityId) === aid && String(s.occurrenceDateKey) === dateKey),
      )
    ) {
      continue
    }
    const title = act.title || aid
    for (const row of rows) {
      const mid = String(row.memberId || '')
      if (!mid) continue
      slots.push({
        activityId: aid,
        title,
        dateKey,
        memberId: mid,
        characterName: row.characterName || '',
        pathway: '',
        status: row.status,
      })
    }
  }

  const byMember = new Map()
  for (const s of slots) {
    const m = ensureMemberBucket(byMember, s.memberId, s.characterName, s.pathway)
    if (s.characterName && !m.characterName) m.characterName = s.characterName
    if (s.pathway && !m.pathway) m.pathway = s.pathway
    if (RSVP_STATUSES.has(s.status)) {
      m[s.status] += 1
      m.total += 1
    }
    m.recent.push({
      activityId: s.activityId,
      title: s.title,
      dateKey: s.dateKey,
      status: s.status,
      statusLabel: s.status === 'going' ? '参加' : s.status === 'maybe' ? '待定' : '请假',
    })
  }

  // 已保存实到（含未报名补录）
  for (const doc of attendanceDocs) {
    const dateKey = String(doc.occurrenceDateKey || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < cutoff) continue
    const aid = String(doc.activityId || '')
    const title = activityMap.get(aid)?.title || aid
    const ids = Array.isArray(doc.presentMemberIds) ? doc.presentMemberIds : []
    for (const rawId of ids) {
      const mid = String(rawId || '')
      if (!mid) continue
      const m = ensureMemberBucket(byMember, mid)
      m.present += 1
      m.recent.push({
        activityId: aid,
        title,
        dateKey,
        status: 'present',
        statusLabel: '实到',
      })
    }
  }

  // 补全角色名/途径
  const members = await cloudMembers.listMembers({ sort: 'characterName', order: 'asc' })
  const brief = new Map(members.map((m) => [String(m.id), m]))

  const list = [...byMember.values()].map((m) => {
    const b = brief.get(m.memberId)
    const characterName = b?.characterName || m.characterName || m.memberId
    const pathway = b?.pathway || m.pathway || ''
    const intentionRate = m.total > 0 ? Math.round((m.going / m.total) * 100) : null
    m.recent.sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)))
    return {
      memberId: m.memberId,
      characterName,
      pathway,
      going: m.going,
      maybe: m.maybe,
      decline: m.decline,
      present: m.present,
      total: m.total,
      intentionRate,
      recent: m.recent.slice(0, 20),
    }
  })

  list.sort((a, b) => String(a.characterName).localeCompare(String(b.characterName), 'zh-CN'))

  return {
    weeks: w,
    cutoffDateKey: cutoff,
    todayDateKey: today,
    members: list,
  }
}
