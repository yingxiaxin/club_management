/**
 * 成员端：已发布活动只读 + 今日/本周日程 + RSVP 挂载
 */
const cloud = require('wx-server-sdk')
const { decorate, splitSchedule } = require('./scheduleMatch')
const rsvpsDb = require('./rsvpsDb')
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

async function listSchedule(now = new Date()) {
  const visible = await listVisibleActivities()
  const schedule = splitSchedule(visible, now)
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
  if (Array.isArray(activity.reminderOffsetsMinutes) && activity.reminderOffsetsMinutes.length) {
    return clubDb.normalizeOffsets(activity.reminderOffsetsMinutes, clubOffsets)
  }
  return clubOffsets.slice()
}

async function getPublishedActivity(
  id,
  { memberId = null, openid = null } = {},
) {
  const row = await getRawPublished(id)
  if (!row) return null
  const activity = decorate(row)
  const [rsvp, club, sub] = await Promise.all([
    rsvpsDb.summarize(id, memberId),
    clubDb.getClubProfile(),
    openid ? subscriptionsDb.getMine(id, openid) : Promise.resolve(null),
  ])
  const offsets = effectiveOffsets(activity, club.reminderOffsetsMinutes)
  const canSubscribeReminder =
    activity.reminderCycle !== 'none' &&
    offsets.length > 0 &&
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
  }
}

module.exports = {
  listSchedule,
  getPublishedActivity,
  getRawPublished,
  VISIBLE_STATUSES,
}
