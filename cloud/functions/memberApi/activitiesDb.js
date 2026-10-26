/**
 * 成员端：已发布活动只读 + 今日/本周日程 + RSVP 挂载
 */
const cloud = require('wx-server-sdk')
const {
  decorate,
  splitSchedule,
  resolveOccurrence,
  isPeriodicTemplate,
} = require('./scheduleMatch')

const ENDABLE_STATUSES = new Set(['published', 'ongoing'])
const rsvpsDb = require('./rsvpsDb')
const teamsDb = require('./teamsDb')
const clubDb = require('./clubDb')
const subscriptionsDb = require('./subscriptionsDb')

const COLLECTION = 'activities'
const VISIBLE_STATUSES = new Set(['published', 'ongoing'])

function db() {
  return cloud.database()
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function err(message, status = 400) {
  const e = new Error(message)
  e.status = status
  return e
}

async function fetchAllActivities() {
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all.map(toClient)
}

async function listVisibleActivities() {
  const list = await fetchAllActivities()
  return list.filter((a) => VISIBLE_STATUSES.has(a.status))
}

function emptyCounts() {
  return { going: 0, maybe: 0, decline: 0, total: 0 }
}

async function attachRsvpCounts(list) {
  const ids = list.map((a) => a.id)
  const map = await rsvpsDb.countByActivityIds(ids)
  return list.map((a) => ({
    ...a,
    rsvpCounts: map.get(String(a.id)) || emptyCounts(),
  }))
}

async function patchActivityCycle(id, data) {
  await db()
    .collection(COLLECTION)
    .doc(String(id))
    .update({
      data: {
        ...data,
        updatedAt: new Date().toISOString(),
      },
    })
}

/**
 * 周期模板：本场结束后清空 RSVP + 队伍，并记下清档/下场 key；
 * **保持 status=published/ongoing**（可滚下一场）。
 */
async function ensureCycleRollover(raw) {
  if (!raw || !isPeriodicTemplate(raw)) return raw
  const occ = resolveOccurrence(raw)
  if (!occ.dateKey) return raw

  const patch = {}

  if (occ.ended) {
    if (raw.cycleClearedKey !== occ.dateKey) {
      await rsvpsDb.deleteAllByActivity(raw.id, occ.dateKey)
      await teamsDb.dissolveAllByActivity(raw.id)
      patch.cycleClearedKey = occ.dateKey
      if (occ.nextDateKey) patch.activeCycleKey = occ.nextDateKey
    }
  } else {
    if (raw.activeCycleKey && raw.activeCycleKey !== occ.dateKey) {
      if (raw.cycleClearedKey !== raw.activeCycleKey) {
        await rsvpsDb.deleteAllByActivity(raw.id, raw.activeCycleKey)
        await teamsDb.dissolveAllByActivity(raw.id)
        patch.cycleClearedKey = raw.activeCycleKey
      }
    }
    if (raw.activeCycleKey !== occ.dateKey) {
      patch.activeCycleKey = occ.dateKey
    }
  }

  if (!Object.keys(patch).length) return raw
  try {
    await patchActivityCycle(raw.id, patch)
    return { ...raw, ...patch }
  } catch (e) {
    console.warn('[activitiesDb] ensureCycleRollover', raw.id, e?.message || e)
    return raw
  }
}

/**
 * 一次性活动（锚定开始）：本场结束后 → status=ended，并关闭仍在招募的队伍。
 * 周期模板不走本逻辑。
 */
async function ensureOneTimeEnded(raw, now = new Date()) {
  if (!raw || isPeriodicTemplate(raw)) return raw
  if (!ENDABLE_STATUSES.has(raw.status)) return raw
  const occ = resolveOccurrence(raw, now)
  if (!occ.ended) return raw

  const nowIso = new Date().toISOString()
  try {
    await teamsDb.closeActiveTeamsByActivity(raw.id, '活动已结束')
    await db()
      .collection(COLLECTION)
      .doc(String(raw.id))
      .update({
        data: {
          status: 'ended',
          updatedAt: nowIso,
        },
      })
    return { ...raw, status: 'ended', updatedAt: nowIso }
  } catch (e) {
    console.warn('[activitiesDb] ensureOneTimeEnded', raw.id, e?.message || e)
    return raw
  }
}

/** 定时/联调：扫所有已发布一次性活动，到点标 ended */
async function expireOneTimeActivitiesDue(now = new Date()) {
  const list = await fetchAllActivities()
  const ended = []
  for (const raw of list) {
    if (!ENDABLE_STATUSES.has(raw.status)) continue
    if (isPeriodicTemplate(raw)) continue
    const next = await ensureOneTimeEnded(raw, now)
    if (next.status === 'ended' && raw.status !== 'ended') {
      ended.push(raw.id)
    }
  }
  return { ended }
}

async function listSchedule(now = new Date()) {
  const visible = await listVisibleActivities()
  const rolled = []
  for (const a of visible) {
    let row = await ensureOneTimeEnded(a, now)
    if (!ENDABLE_STATUSES.has(row.status)) continue
    row = await ensureCycleRollover(row)
    if (!ENDABLE_STATUSES.has(row.status)) continue
    rolled.push(row)
  }
  const schedule = splitSchedule(rolled, now)
  const [today, week] = await Promise.all([
    attachRsvpCounts(schedule.today),
    attachRsvpCounts(schedule.week),
  ])
  return { ...schedule, today, week }
}

async function getRawPublished(id) {
  try {
    const res = await db().collection(COLLECTION).doc(String(id)).get()
    const row = toClient(res.data)
    if (!row) return null
    if (!VISIBLE_STATUSES.has(row.status)) {
      throw err('活动不可见或不存在', 404)
    }
    return row
  } catch (e) {
    if (e.status) throw e
    return null
  }
}

function effectiveOffsets(activity, clubOffsets) {
  if (activity.reminderCycle === 'none') return []
  // 提前量一律俱乐部提醒设置
  return clubDb.normalizeOffsets(clubOffsets, [10])
}

async function getPublishedActivity(
  id,
  { memberId = null, openid = null } = {},
) {
  let row = await getRawPublished(id)
  if (!row) return null
  row = await ensureOneTimeEnded(row)
  if (!VISIBLE_STATUSES.has(row.status)) {
    throw err('活动不可见或不存在', 404)
  }
  row = await ensureCycleRollover(row)
  const activity = decorate(row)
  const [rsvp, club, sub, teamList] = await Promise.all([
    rsvpsDb.summarize(id, memberId),
    clubDb.getClubProfile(),
    openid ? subscriptionsDb.getMine(id, openid) : Promise.resolve(null),
    activity.enableTeam
      ? teamsDb.listTeamsByActivity(id, memberId).catch(() => [])
      : Promise.resolve([]),
  ])
  const offsets = effectiveOffsets(activity, club.reminderOffsetsMinutes)
  const canSubscribeReminder =
    activity.reminderCycle !== 'none' &&
    offsets.length > 0 &&
    !activity.occurrenceEnded &&
    Boolean(activity.canChangeRsvp || activity.minutesUntil == null || activity.minutesUntil > 0)

  return {
    ...activity,
    rsvpCounts: rsvp.counts,
    rsvpGroups: rsvp.groups,
    myRsvp: rsvp.myStatus,
    reminderEffectiveOffsets: offsets,
    subscribeTemplateId: club.subscribeTemplateId || '',
    hasSubscribeTemplate: Boolean(club.subscribeTemplateId),
    myReminderSubscribed: Boolean(sub && sub.status === 'active'),
    canSubscribeReminder,
    teamCount: Array.isArray(teamList) ? teamList.length : 0,
  }
}

module.exports = {
  listSchedule,
  getPublishedActivity,
  getRawPublished,
  ensureCycleRollover,
  ensureOneTimeEnded,
  expireOneTimeActivitiesDue,
  VISIBLE_STATUSES,
}
