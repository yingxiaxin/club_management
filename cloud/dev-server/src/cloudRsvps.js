/**
 * 云库 activity_rsvps / activity_rsvp_snapshots（管理端本机 API）
 * 约定：docs/P1-c出席意向RSVP.md
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const RSVPS = 'activity_rsvps'
const SNAPSHOTS = 'activity_rsvp_snapshots'
const MEMBERS = 'members'

const STATUS_ORDER = { going: 0, maybe: 1, decline: 2 }
const STATUS_LABELS = {
  going: '参加',
  maybe: '待定',
  decline: '请假',
}

let app = null

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

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function sortExportRows(enriched) {
  enriched.sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 9
    const ob = STATUS_ORDER[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return String(a.characterName).localeCompare(String(b.characterName), 'zh-CN')
  })
  return enriched
}

async function listByActivity(activityId) {
  const id = String(activityId)
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await database
      .collection(RSVPS)
      .where({ activityId: id })
      .skip(offset)
      .limit(pageSize)
      .get()
    const rows = (res.data || []).map(toClient)
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function fetchMemberBriefs(memberIds) {
  const ids = [...new Set(memberIds.filter(Boolean).map(String))]
  const map = new Map()
  const database = getDb()
  for (const id of ids) {
    try {
      const res = await database.collection(MEMBERS).doc(id).get()
      const row = Array.isArray(res.data) ? res.data[0] : res.data
      map.set(id, {
        characterName: (row && row.characterName) || '',
        pathway: (row && row.pathway) || '',
      })
    } catch {
      map.set(id, { characterName: '', pathway: '' })
    }
  }
  return map
}

function enrichLiveRows(rows, briefMap, activityTime) {
  const enriched = rows
    .filter((r) => STATUS_LABELS[r.status])
    .map((r) => {
      const brief = briefMap.get(String(r.memberId)) || {}
      return {
        memberId: String(r.memberId || ''),
        characterName: brief.characterName || r.characterName || r.memberId || '',
        pathway: brief.pathway || '',
        status: r.status,
        statusLabel: STATUS_LABELS[r.status],
        activityTime,
      }
    })
  return sortExportRows(enriched)
}

function enrichSnapshotRows(rows, activityTime) {
  const enriched = (rows || [])
    .filter((r) => STATUS_LABELS[r.status])
    .map((r) => ({
      memberId: String(r.memberId || ''),
      characterName: r.characterName || r.memberId || '',
      pathway: r.pathway || '',
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      activityTime,
    }))
  return sortExportRows(enriched)
}

/** 本场 RSVP 人员（含 memberId，供点名） */
export async function listLiveRsvpPeople(activityId) {
  const rows = await listByActivity(activityId)
  const briefMap = await fetchMemberBriefs(rows.map((r) => r.memberId))
  return enrichLiveRows(rows, briefMap, '')
}

const WEEKDAY_SHORT = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 导出用活动时间：场次日 + 开始时刻（同文件各行相同） */
export function formatExportActivityTime(activity, dateKey) {
  const key = String(dateKey || 'live').trim() || 'live'
  const sched = activity?.startSchedule || {}
  let time = sched.time ? String(sched.time) : ''
  let y = null
  let m = null
  let d = null

  if (key !== 'live' && key !== 'current' && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const parts = key.split('-').map(Number)
    y = parts[0]
    m = parts[1]
    d = parts[2]
  } else if (
    activity?.activeCycleKey &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(activity.activeCycleKey))
  ) {
    const parts = String(activity.activeCycleKey).split('-').map(Number)
    y = parts[0]
    m = parts[1]
    d = parts[2]
  } else if (sched.year != null && sched.month != null && sched.day != null) {
    y = Number(sched.year)
    m = Number(sched.month)
    d = Number(sched.day)
  } else if (activity?.startAt) {
    const dt = new Date(activity.startAt)
    if (!Number.isNaN(dt.getTime())) {
      y = dt.getFullYear()
      m = dt.getMonth() + 1
      d = dt.getDate()
      if (!time) {
        time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
      }
    }
  }

  const bits = []
  if (y != null && m != null && d != null) bits.push(`${y}年${m}月${d}日`)
  else if (sched.weekday != null && WEEKDAY_SHORT[sched.weekday]) {
    bits.push(WEEKDAY_SHORT[sched.weekday])
  }
  if (time) bits.push(time)
  return bits.join(' ') || '—'
}

async function listSnapshotsByActivity(activityId) {
  const id = String(activityId)
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  try {
    for (;;) {
      const res = await database
        .collection(SNAPSHOTS)
        .where({ activityId: id })
        .skip(offset)
        .limit(pageSize)
        .get()
      const rows = (res.data || []).map(toClient)
      all.push(...rows)
      if (rows.length < pageSize) break
      offset += pageSize
    }
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (/not exist|不存在|COLLECTION_NOT_EXIST/i.test(msg)) return []
    throw e
  }
  all.sort((a, b) => String(b.occurrenceDateKey || '').localeCompare(String(a.occurrenceDateKey || '')))
  return all
}

async function getSnapshot(activityId, dateKey) {
  const id = `${String(activityId)}__${String(dateKey)}`
  try {
    const res = await getDb().collection(SNAPSHOTS).doc(id).get()
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    return toClient(row)
  } catch {
    return null
  }
}

/** 可导出场次：本场 + 已有快照日 */
export async function listRsvpOccurrences(activityId) {
  const liveRows = await listByActivity(activityId)
  const snaps = await listSnapshotsByActivity(activityId)
  const options = [
    {
      dateKey: 'live',
      label: '本场（当前）',
      source: 'live',
      rowCount: liveRows.filter((r) => STATUS_LABELS[r.status]).length,
    },
  ]
  for (const s of snaps) {
    const key = String(s.occurrenceDateKey || '')
    if (!key) continue
    options.push({
      dateKey: key,
      label: key,
      source: 'snapshot',
      rowCount: typeof s.rowCount === 'number' ? s.rowCount : (s.rows || []).length,
    })
  }
  return { options }
}

/**
 * @param {string} activityId
 * @param {string} [dateKey] live / 缺省 = 本场；YYYY-MM-DD = 快照
 * @param {object} [activity] 用于拼活动时间
 */
export async function listRsvpsForExport(activityId, dateKey, activity = null) {
  const key = String(dateKey || 'live').trim() || 'live'
  const activityTime = formatExportActivityTime(activity || {}, key)
  if (key === 'live' || key === 'current' || key === '') {
    const rows = await listByActivity(activityId)
    const briefMap = await fetchMemberBriefs(rows.map((r) => r.memberId))
    return enrichLiveRows(rows, briefMap, activityTime)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw Object.assign(new Error('场次日格式须为 YYYY-MM-DD'), { status: 400 })
  }
  const snap = await getSnapshot(activityId, key)
  if (!snap) {
    throw Object.assign(new Error(`无该场次快照（${key}）；换场前未落档的历史无法补导`), {
      status: 404,
    })
  }
  return enrichSnapshotRows(snap.rows, activityTime)
}

export { STATUS_LABELS }
