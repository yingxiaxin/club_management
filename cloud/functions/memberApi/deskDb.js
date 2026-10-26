/**
 * 「我的」页聚合 myDesk（P3-desk-a）
 * 产品：docs/P3出勤与个人中心.md；本周请假已砍；不含实到
 */
const { decorate } = require('./scheduleMatch')
const rsvpsDb = require('./rsvpsDb')
const teamsDb = require('./teamsDb')
const subscriptionsDb = require('./subscriptionsDb')
const activitiesDb = require('./activitiesDb')

const RSVP_LABELS = rsvpsDb.STATUS_LABELS || {
  going: '参加',
  maybe: '待定',
  decline: '请假',
}

const TEAM_STATUS_LABELS = {
  recruiting: '招募中',
  full: '已满员',
  paused: '已关招募',
  started: '已开始',
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
  const yy = x.getUTCFullYear()
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(x.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function emptyDeskBase(access, openid) {
  const { user, member, isAdmin, canViewMembers } = access
  return {
    openid,
    role: user.role,
    displayName: user.displayName || member?.characterName || '',
    memberId: user.memberId || null,
    member: member || null,
    canViewMembers: Boolean(canViewMembers),
    isAdmin: Boolean(isAdmin),
    pendingApprovalCount: 0,
    pendingTeams: [],
    rsvpsActive: [],
    rsvpsEnded: [],
    teams: [],
    reminders: [],
  }
}

/**
 * @param {{ openid: string, access: object, joinApplication?: object|null }} opts
 */
async function buildMyDesk({ openid, access, joinApplication = null }) {
  const base = emptyDeskBase(access, openid)
  base.joinApplication = joinApplication

  if (!access.canViewMembers || !access.member?.id) {
    return base
  }

  const memberId = access.member.id
  const now = new Date()
  const todayKey = shanghaiYmd(now)
  const cutoffKey = addCalendarDays(todayKey, -14)

  const [rsvpRows, myTeams, pending, subs] = await Promise.all([
    rsvpsDb.listByMember(memberId),
    teamsDb.listMyTeams(memberId, {}),
    teamsDb.listPendingApprovalsForLeader(memberId),
    subscriptionsDb.listActiveByOpenid(openid),
  ])

  const rsvpsActive = []
  const rsvpsEnded = []
  for (const row of rsvpRows) {
    let raw = null
    try {
      raw = await activitiesDb.getRawPublished(row.activityId)
      if (raw) raw = await activitiesDb.ensureCycleRollover(raw)
    } catch {
      raw = null
    }
    if (!raw) continue
    const act = decorate(raw, now)
    const item = {
      activityId: act.id,
      title: act.title,
      startText: act.startText,
      occurrenceDateKey: act.occurrenceDateKey || '',
      occurrencePhase: act.occurrencePhase,
      occurrencePhaseLabel: act.occurrencePhaseLabel,
      status: row.status,
      statusLabel: RSVP_LABELS[row.status] || row.status,
      canChangeRsvp: Boolean(act.canChangeRsvp),
    }
    if (act.occurrenceEnded || act.status === 'ended') {
      const key = act.occurrenceDateKey || ''
      if (!key || key >= cutoffKey) rsvpsEnded.push(item)
    } else {
      rsvpsActive.push(item)
    }
  }

  const phaseRank = { live: 0, upcoming: 1, ended: 2 }
  rsvpsActive.sort((a, b) => {
    const ra = phaseRank[a.occurrencePhase] ?? 9
    const rb = phaseRank[b.occurrencePhase] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.occurrenceDateKey || '').localeCompare(String(b.occurrenceDateKey || ''))
  })
  rsvpsEnded.sort((a, b) =>
    String(b.occurrenceDateKey || '').localeCompare(String(a.occurrenceDateKey || '')),
  )

  const activityTitleCache = new Map()
  async function activityTitle(activityId) {
    const id = String(activityId || '')
    if (!id) return ''
    if (activityTitleCache.has(id)) return activityTitleCache.get(id)
    let title = ''
    try {
      const raw = await activitiesDb.getRawPublished(id)
      title = (raw && raw.title) || ''
    } catch {
      title = ''
    }
    activityTitleCache.set(id, title)
    return title
  }

  const teamsOut = []
  for (const t of myTeams) {
    const title = await activityTitle(t.activityId)
    teamsOut.push({
      id: t.id,
      activityId: t.activityId,
      activityTitle: title,
      modeName: t.modeName || '',
      status: t.status,
      statusLabel: TEAM_STATUS_LABELS[t.status] || t.status,
      memberCount: t.memberCount || 0,
      maxMembers: t.maxMembers || 0,
      myIsLeader: Boolean(t.myIsLeader),
      startAt: t.startAt || null,
    })
  }
  teamsOut.sort((a, b) => {
    const aLive = a.status === 'started' || a.status === 'recruiting' || a.status === 'full' ? 0 : 1
    const bLive = b.status === 'started' || b.status === 'recruiting' || b.status === 'full' ? 0 : 1
    if (aLive !== bLive) return aLive - bLive
    if (a.myIsLeader !== b.myIsLeader) return a.myIsLeader ? -1 : 1
    return String(b.startAt || '').localeCompare(String(a.startAt || ''))
  })

  const pendingTeams = []
  for (const p of pending.pendingTeams || []) {
    const title = await activityTitle(p.activityId)
    pendingTeams.push({
      ...p,
      activityTitle: title,
    })
  }

  const reminders = []
  for (const s of subs) {
    let raw = null
    try {
      raw = await activitiesDb.getRawPublished(s.activityId)
      if (raw) raw = await activitiesDb.ensureCycleRollover(raw)
    } catch {
      raw = null
    }
    if (!raw) continue
    const act = decorate(raw, now)
    if (act.occurrenceEnded) continue
    reminders.push({
      activityId: act.id,
      title: act.title,
      startText: act.startText,
    })
  }

  return {
    ...base,
    pendingApprovalCount: pending.pendingApprovalCount || 0,
    pendingTeams,
    rsvpsActive,
    rsvpsEnded,
    teams: teamsOut,
    reminders,
  }
}

module.exports = {
  buildMyDesk,
}
