/**
 * 管理端出勤看板（P3-board-a/b）
 * 约定：docs/P3出勤与个人中心.md
 */
import tcb from '@cloudbase/node-sdk'
import { createRequire } from 'module'
import * as cloudMembers from './cloudMembers.js'
import * as cloudActivities from './cloudActivities.js'
import * as cloudTeams from './cloudTeams.js'
import * as cloudRsvps from './cloudRsvps.js'
import * as cloudAttendance from './cloudAttendance.js'

const require = createRequire(import.meta.url)
const { splitSchedule } = require('../../functions/memberApi/scheduleMatch.js')

const BOARD_STATUSES = new Set(['published', 'ongoing', 'ended'])
const RSVP_STATUSES = new Set(['going', 'maybe', 'decline'])
const RECRUITING = 'recruiting'
const RSVPS = 'activity_rsvps'

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

function emptyCounts() {
  return { going: 0, maybe: 0, decline: 0, total: 0 }
}

function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function teamOnDate(team, dateKeyFallback, targetYmd) {
  let ymd = ''
  if (team.startAt) {
    const d = new Date(team.startAt)
    if (!Number.isNaN(d.getTime())) ymd = shanghaiYmd(d)
  }
  if (!ymd && dateKeyFallback) ymd = String(dateKeyFallback).trim()
  if (!ymd) return false
  return ymd === targetYmd
}

async function countRsvpsByActivityIds(activityIds) {
  const ids = [...new Set((activityIds || []).map(String).filter(Boolean))]
  const result = new Map(ids.map((id) => [id, emptyCounts()]))
  if (!ids.length) return result

  const db = getDb()
  const pageSize = 100
  let offset = 0
  for (;;) {
    const res = await db.collection(RSVPS).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    for (const row of rows) {
      const bucket = result.get(String(row.activityId))
      if (!bucket || !RSVP_STATUSES.has(row.status)) continue
      bucket[row.status] += 1
      bucket.total += 1
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return result
}

function pickBoardCard(decorated, rsvpCounts, teamSummary = null) {
  return {
    id: decorated.id,
    title: decorated.title || '',
    type: decorated.type,
    typeLabel: decorated.typeLabel,
    status: decorated.status,
    statusLabel: decorated.statusLabel,
    enableTeam: Boolean(decorated.enableTeam),
    startText: decorated.startText || '',
    endText: decorated.endText || '',
    occurrenceDateKey: decorated.occurrenceDateKey || null,
    occurrencePhase: decorated.occurrencePhase || null,
    occurrencePhaseLabel: decorated.occurrencePhaseLabel || '',
    occurrenceEnded: Boolean(decorated.occurrenceEnded),
    occurrenceStarted: Boolean(decorated.occurrenceStarted),
    isPeriodic: Boolean(decorated.isPeriodic),
    rsvpCounts: rsvpCounts || emptyCounts(),
    teamSummary,
  }
}

function buildTeamSummary(teams, dateKey, todayKey) {
  const relevant = (teams || []).filter((t) => teamOnDate(t, dateKey, todayKey))
  const recruiting = relevant.filter((t) => t.status === RECRUITING)
  let seatsShort = 0
  for (const t of recruiting) {
    const max = Number(t.maxMembers) || 0
    const cur = Array.isArray(t.memberIds) ? t.memberIds.length : Number(t.memberCount) || 0
    if (max > cur) seatsShort += max - cur
  }
  return {
    recruitingCount: recruiting.length,
    seatsShort,
    todayTeamCount: relevant.length,
  }
}

async function loadBoardLists(now = new Date()) {
  const all = await cloudActivities.listActivities()
  const candidates = all.filter((a) => BOARD_STATUSES.has(a.status))
  return splitSchedule(candidates, now)
}

/** 今日一屏：今日本场 + RSVP +（开启组队时）今日队伍摘要 */
export async function getTodayBoard(now = new Date()) {
  const schedule = await loadBoardLists(now)
  const todayKey = shanghaiYmd(now)
  const ids = schedule.today.map((a) => a.id)
  const [countsMap, allTeams] = await Promise.all([
    countRsvpsByActivityIds(ids),
    ids.length ? cloudTeams.listTeams() : Promise.resolve([]),
  ])

  const teamsByActivity = new Map()
  for (const t of allTeams) {
    const aid = String(t.activityId || '')
    if (!aid) continue
    if (!teamsByActivity.has(aid)) teamsByActivity.set(aid, [])
    teamsByActivity.get(aid).push(t)
  }

  const activities = schedule.today.map((row) => {
    const counts = countsMap.get(String(row.id)) || emptyCounts()
    let teamSummary = null
    if (row.enableTeam) {
      teamSummary = buildTeamSummary(
        teamsByActivity.get(String(row.id)) || [],
        row.occurrenceDateKey,
        todayKey,
      )
    }
    return pickBoardCard(row, counts, teamSummary)
  })

  return {
    meta: schedule.meta,
    activities: await cloudAttendance.attachAttendanceBriefs(activities),
  }
}

/** @deprecated 兼容旧名；请用 getTodayBoard */
export const getTonightBoard = getTodayBoard

/** 本周概览：本周各活动 RSVP + 已点名实到 */
export async function getWeekBoard(now = new Date()) {
  const schedule = await loadBoardLists(now)
  const ids = schedule.week.map((a) => a.id)
  const countsMap = await countRsvpsByActivityIds(ids)
  const activities = schedule.week.map((row) => {
    const counts = countsMap.get(String(row.id)) || emptyCounts()
    return pickBoardCard(row, counts, null)
  })
  return {
    meta: schedule.meta,
    activities: await cloudAttendance.attachAttendanceBriefs(activities),
  }
}

/** 本场 RSVP 名单（看板点进详情；含 memberId） */
export async function getActivityRsvpSummary(activityId) {
  const activity = await cloudActivities.getActivity(activityId)
  if (!activity) {
    throw Object.assign(new Error('活动不存在'), { status: 404 })
  }
  const rows = await cloudRsvps.listLiveRsvpPeople(activityId)
  const groups = { going: [], maybe: [], decline: [] }
  const counts = emptyCounts()
  for (const r of rows) {
    if (!RSVP_STATUSES.has(r.status)) continue
    groups[r.status].push({
      memberId: r.memberId || '',
      characterName: r.characterName || '',
      pathway: r.pathway || '',
      status: r.status,
      statusLabel: r.statusLabel || '',
    })
    counts[r.status] += 1
    counts.total += 1
  }
  return {
    activityId: String(activityId),
    title: activity.title || '',
    counts,
    groups,
  }
}
