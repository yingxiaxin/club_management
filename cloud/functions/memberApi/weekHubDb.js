/**
 * 首页「本周会务」聚合 weekHub（P4 A-a/A-b）
 * 产品：docs/P4本周会务.md
 */
const activitiesDb = require('./activitiesDb')
const rsvpsDb = require('./rsvpsDb')
const teamsDb = require('./teamsDb')
const membersDb = require('./membersDb')

const RSVP_LABELS = rsvpsDb.STATUS_LABELS || {
  going: '参加',
  maybe: '待定',
  decline: '请假',
}

const MAX_ACTIVITIES = 5
const MAX_TEAM_GAPS = 3

/** 途径 → 职责：观众=奶(N)，战士=T，其余=输出(D) */
function pathwayToDuty(pathway) {
  const p = String(pathway || '').trim()
  if (p === '观众') return 'healer'
  if (p === '战士') return 'tank'
  return 'dps'
}

/**
 * 满编职责配额：6 人 = 1T 1N 4D；12 人 = 1T 2N 9D；其它人数回退 1T 1N + 其余 D。
 */
function compositionNeeds(maxMembers) {
  const n = Math.max(0, Number(maxMembers) || 0)
  if (n === 12) return { tank: 1, healer: 2, dps: 9 }
  if (n === 6) return { tank: 1, healer: 1, dps: 4 }
  return { tank: 1, healer: 1, dps: Math.max(0, n - 2) }
}

/**
 * 相对满编配额算缺口；空位优先补 T → N → D，且不超过 seatsShort。
 */
function computeRoleGap(pathways, seatsShort, maxMembers) {
  let tank = 0
  let healer = 0
  let dps = 0
  for (const p of pathways || []) {
    const duty = pathwayToDuty(p)
    if (duty === 'tank') tank += 1
    else if (duty === 'healer') healer += 1
    else dps += 1
  }
  const need = compositionNeeds(maxMembers)
  let remaining = Math.max(0, Number(seatsShort) || 0)
  const shortTank = Math.min(Math.max(0, need.tank - tank), remaining)
  remaining -= shortTank
  const shortHealer = Math.min(Math.max(0, need.healer - healer), remaining)
  remaining -= shortHealer
  const shortDps = Math.min(Math.max(0, need.dps - dps), remaining)

  const parts = []
  if (shortTank > 0) parts.push(shortTank > 1 ? `缺T×${shortTank}` : '缺T')
  if (shortHealer > 0) parts.push(shortHealer > 1 ? `缺N×${shortHealer}` : '缺N')
  if (shortDps > 0) parts.push(shortDps > 1 ? `缺D×${shortDps}` : '缺D')
  return {
    shortTank,
    shortHealer,
    shortDps,
    roleGapLabel: parts.length ? parts.join(' · ') : `差 ${seatsShort} 人`,
  }
}

async function pathwaysForMemberIds(memberIds) {
  const ids = [...new Set((memberIds || []).map(String).filter(Boolean))]
  const out = []
  for (const id of ids) {
    try {
      const m = await membersDb.getMember(id)
      out.push((m && m.pathway) || '')
    } catch {
      out.push('')
    }
  }
  return out
}

function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function partsToKey(parts) {
  if (!parts || parts.year == null) return ''
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

/**
 * @param {{ member?: { id?: string }, user?: { memberId?: string|null }, openid?: string }} access
 */
async function buildWeekHub(access) {
  const memberId = String(
    (access && access.member && access.member.id) ||
      (access && access.user && access.user.memberId) ||
      '',
  ).trim()

  // 即使暂时解析不到 memberId，仍返回本周日程数量，避免首页顶行全 0
  let schedule
  try {
    schedule = await activitiesDb.listSchedule()
  } catch (e) {
    console.error('[weekHub] listSchedule', e && e.message ? e.message : e)
    throw e
  }

  const todayKey =
    partsToKey(schedule.meta && schedule.meta.today) || shanghaiYmd()
  const todayCount = Array.isArray(schedule.today) ? schedule.today.length : 0
  const weekCount = Array.isArray(schedule.week) ? schedule.week.length : 0

  if (!memberId) {
    console.warn('[weekHub] missing memberId, return schedule counts only')
    return {
      todayKey,
      weekStart: (schedule.meta && schedule.meta.weekStart) || null,
      weekEnd: (schedule.meta && schedule.meta.weekEnd) || null,
      todayCount,
      weekCount,
      pendingApprovalCount: 0,
      pendingTeams: [],
      activities: [],
      teamGaps: [],
    }
  }

  let rsvpRows = []
  let myTeams = []
  let pending = { pendingApprovalCount: 0, pendingTeams: [] }
  try {
    const pack = await Promise.all([
      rsvpsDb.listByMember(memberId),
      teamsDb.listMyTeams(memberId, {}),
      teamsDb.listPendingApprovalsForLeader(memberId),
    ])
    rsvpRows = pack[0] || []
    myTeams = pack[1] || []
    pending = pack[2] || pending
  } catch (e) {
    console.error('[weekHub] member packs', e && e.message ? e.message : e)
  }

  const rsvpByActivity = new Map()
  for (const row of rsvpRows || []) {
    const aid = String(row.activityId || '')
    if (!aid) continue
    if (row.status && RSVP_LABELS[row.status]) {
      rsvpByActivity.set(aid, row.status)
    }
  }

  // listSchedule 的 today/week 已按 sortActivities 排好；此处只做「今日优先 + 去重」
  const merged = []
  const seen = new Set()
  function pushActs(list) {
    for (const act of list || []) {
      if (!act || !act.id) continue
      const id = String(act.id)
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(act)
    }
  }
  pushActs(schedule.today)
  pushActs(schedule.week)
  const activities = merged.slice(0, MAX_ACTIVITIES).map(function (act) {
    const myRsvp = rsvpByActivity.get(String(act.id)) || null
    const dateKey = act.occurrenceDateKey || ''
    // 兜底：未结束场次必须有紧迫档；图标由小程序按 class 映射，避免云函数源码含 emoji
    let urgencyClass = act.urgencyClass || ''
    let urgency = act.urgency || ''
    if (!urgencyClass && act.occurrencePhase !== 'ended') {
      if (act.occurrencePhase === 'live') {
        urgency = 'hot'
        urgencyClass = 'urgency-hot'
      } else {
        urgency = 'calm'
        urgencyClass = 'urgency-calm'
      }
    }
    if (!urgency && urgencyClass) {
      urgency = String(urgencyClass).replace(/^urgency-/, '')
    }
    return {
      id: act.id,
      title: act.title || '',
      startText: act.startText || '',
      occurrenceDateKey: dateKey,
      occurrencePhase: act.occurrencePhase || '',
      occurrencePhaseLabel: act.occurrencePhaseLabel || '',
      isToday: dateKey === todayKey,
      typeLabel: act.typeLabel || '',
      urgency: urgency,
      urgencyClass: urgencyClass,
      minutesUntil: act.minutesUntil,
      myRsvp: myRsvp,
      myRsvpLabel: myRsvp ? RSVP_LABELS[myRsvp] || myRsvp : '未表态',
    }
  })

  const activityTitleCache = new Map()
  for (const act of merged) {
    if (act?.id) activityTitleCache.set(String(act.id), act.title || '')
  }
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

  const teamGaps = []
  for (const t of myTeams || []) {
    if (t.status !== 'recruiting') continue
    const maxMembers = Number(t.maxMembers) || 0
    const memberCount = Number(t.memberCount) || 0
    const seatsShort = Math.max(0, maxMembers - memberCount)
    if (seatsShort <= 0) continue
    const activityTitleText = await activityTitle(t.activityId)
    const pathways = await pathwaysForMemberIds(t.memberIds)
    const roleGap = computeRoleGap(pathways, seatsShort, maxMembers)
    let leaderCharacterName = String(t.leaderCharacterName || '').trim()
    let leaderPathway = String(t.leaderPathway || '').trim()
    if ((!leaderCharacterName || !leaderPathway) && t.leaderMemberId) {
      try {
        const leader = await membersDb.getMember(t.leaderMemberId)
        if (leader) {
          if (!leaderCharacterName) leaderCharacterName = String(leader.characterName || '').trim()
          if (!leaderPathway) leaderPathway = String(leader.pathway || '').trim()
        }
      } catch {
        /* ignore */
      }
    }
    teamGaps.push({
      teamId: t.id,
      activityId: t.activityId || '',
      activityTitle: activityTitleText,
      modeName: t.modeName || '',
      memberCount,
      maxMembers,
      seatsShort,
      myIsLeader: Boolean(t.myIsLeader),
      leaderCharacterName,
      leaderPathway,
      shortTank: roleGap.shortTank,
      shortHealer: roleGap.shortHealer,
      shortDps: roleGap.shortDps,
      roleGapLabel: roleGap.roleGapLabel,
    })
    if (teamGaps.length >= MAX_TEAM_GAPS) break
  }

  const pendingTeams = []
  for (const p of pending.pendingTeams || []) {
    pendingTeams.push({
      teamId: p.teamId,
      activityId: p.activityId || '',
      activityTitle: await activityTitle(p.activityId),
      modeName: p.modeName || '',
      pendingCount: p.pendingCount || 0,
    })
  }

  const meta = schedule.meta || {}
  return {
    todayKey: todayKey,
    weekStart: meta.weekStart || null,
    weekEnd: meta.weekEnd || null,
    todayCount: todayCount,
    weekCount: weekCount,
    pendingApprovalCount: pending.pendingApprovalCount || 0,
    pendingTeams: pendingTeams,
    activities: activities,
    teamGaps: teamGaps,
  }
}

module.exports = {
  buildWeekHub,
}
