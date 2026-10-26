/**
 * 成员端：活动组队 teams / team_applications（P2-a）
 * 约定见 docs/P2组队.md
 */
const cloud = require('wx-server-sdk')
const { resolveOccurrence } = require('./scheduleMatch')

const TEAMS = 'teams'
const APPS = 'team_applications'
const ACTIVITIES = 'activities'
const MEMBERS = 'members'

/** recruiting/full=招募中；paused=关闭招募可再开；started=到点；dissolved=撤销(列表隐藏)；closed=旧强制关闭，视同 dissolved */
const TEAM_STATUSES = new Set([
  'recruiting',
  'full',
  'paused',
  'started',
  'dissolved',
  'closed',
])
const APP_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled', 'kicked'])
const WRITE_ACTIVITY_STATUSES = new Set(['published', 'ongoing'])
/** 可申请 / 自动满员回流 */
const RECRUIT_OPEN_STATUSES = new Set(['recruiting', 'full'])
/** 队长可管队（含关招募后） */
const MANAGE_TEAM_STATUSES = new Set(['recruiting', 'full', 'paused'])
/** 到点可转 started */
const STARTABLE_STATUSES = new Set(['recruiting', 'full', 'paused'])
const HIDDEN_LIST_STATUSES = new Set(['dissolved', 'closed'])

let collectionsReady = false

function db() {
  return cloud.database()
}

function err(message, status = 400) {
  const e = new Error(message)
  e.status = status
  return e
}

/** Asia/Shanghai YYYY-MM-DD（P2-c 今日/本周） */
function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shanghaiWeekdayMon0(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(date)
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  return map[wd] ?? 0
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

/** timeFilter: today|tonight|week；tonight 兼容旧值。无 startAt 时可用活动本场 dateKey 兜底 */
function matchTeamTimeFilter(startAt, timeFilter, dateKeyFallback) {
  let key = String(timeFilter || '').trim()
  if (key === 'tonight') key = 'today'
  if (!key) return true
  let ymd = ''
  if (startAt) {
    const d = new Date(startAt)
    if (!Number.isNaN(d.getTime())) ymd = shanghaiYmd(d)
  }
  if (!ymd && dateKeyFallback) ymd = String(dateKeyFallback).trim()
  if (!ymd) return false
  const today = shanghaiYmd(new Date())
  if (key === 'today') return ymd === today
  if (key === 'week') {
    const mon0 = shanghaiWeekdayMon0(new Date())
    const monday = addCalendarDays(today, -mon0)
    const sunday = addCalendarDays(monday, 6)
    return ymd >= monday && ymd <= sunday
  }
  return true
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function appDocId(teamId, memberId) {
  return `${String(teamId)}__${String(memberId)}`
}

function nowIso() {
  return new Date().toISOString()
}

function parseStartAt(raw) {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) throw err('开打时间无效', 400)
  return d.toISOString()
}

async function ensureCollections() {
  if (collectionsReady) return
  for (const name of [TEAMS, APPS]) {
    try {
      await db().createCollection(name)
    } catch (e) {
      const msg = String(e?.message || e || '')
      if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
        console.warn('[teamsDb] createCollection', name, msg)
      }
    }
  }
  collectionsReady = true
}

async function getActivityRaw(activityId) {
  try {
    const res = await db().collection(ACTIVITIES).doc(String(activityId)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function getMemberRaw(memberId) {
  try {
    const res = await db().collection(MEMBERS).doc(String(memberId)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function getTeam(teamId) {
  await ensureCollections()
  try {
    const res = await db().collection(TEAMS).doc(String(teamId)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function getApplication(teamId, memberId) {
  await ensureCollections()
  try {
    const res = await db().collection(APPS).doc(appDocId(teamId, memberId)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function fetchAll(collection, where = null) {
  await ensureCollections()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    let query = db().collection(collection)
    if (where) query = query.where(where)
    const res = await query.skip(offset).limit(pageSize).get()
    const rows = (res.data || []).map(toClient)
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function listTeamsByActivityId(activityId) {
  return fetchAll(TEAMS, { activityId: String(activityId) })
}

async function listAppsByTeam(teamId) {
  return fetchAll(APPS, { teamId: String(teamId) })
}

async function listPendingByTeam(teamId) {
  const rows = await listAppsByTeam(teamId)
  return rows.filter((r) => r.status === 'pending')
}

/** 成员在本活动是否已有队籍（已撤销/旧 closed 不计） */
async function findMembershipOnActivity(activityId, memberId) {
  const teams = await listTeamsByActivityId(activityId)
  const mid = String(memberId)
  for (const t of teams) {
    if (HIDDEN_LIST_STATUSES.has(t.status)) continue
    if (!Array.isArray(t.memberIds)) continue
    if (t.memberIds.map(String).includes(mid)) {
      return t
    }
  }
  return null
}

function assertCanWriteOnActivity(activity, { needEnableTeam = true } = {}) {
  if (!activity) throw err('活动不存在', 404)
  if (!WRITE_ACTIVITY_STATUSES.has(activity.status)) {
    throw err('活动未开放，无法进行组队操作', 409)
  }
  if (needEnableTeam && !activity.enableTeam) {
    throw err('该活动未开启组队', 409)
  }
  const occ = resolveOccurrence(activity)
  if (occ.ended) {
    throw err('本场活动已结束，无法进行组队操作', 409)
  }
}

function assertManageableTeam(team) {
  if (!team) throw err('队伍不存在', 404)
  if (!MANAGE_TEAM_STATUSES.has(team.status)) {
    throw err('队伍已结束，无法操作', 409)
  }
}

function deriveTeamStatus(memberIds, maxMembers, currentStatus) {
  if (
    currentStatus === 'started' ||
    currentStatus === 'dissolved' ||
    currentStatus === 'closed' ||
    currentStatus === 'paused'
  ) {
    return currentStatus
  }
  const count = Array.isArray(memberIds) ? memberIds.length : 0
  if (count >= maxMembers) return 'full'
  return 'recruiting'
}

async function rejectAllPending(teamId, reasonNote) {
  const pending = await listPendingByTeam(teamId)
  const now = nowIso()
  await Promise.all(
    pending.map((row) =>
      db()
        .collection(APPS)
        .doc(appDocId(teamId, row.memberId))
        .update({
          data: {
            status: 'rejected',
            reviewedAt: now,
            reviewNote: reasonNote || '',
            updatedAt: now,
          },
        }),
    ),
  )
}

async function cancelOtherPendingOnActivity(activityId, memberId, exceptTeamId) {
  const teams = await listTeamsByActivityId(activityId)
  const mid = String(memberId)
  const now = nowIso()
  for (const t of teams) {
    if (String(t.id) === String(exceptTeamId)) continue
    const app = await getApplication(t.id, mid)
    if (app && app.status === 'pending') {
      await db()
        .collection(APPS)
        .doc(appDocId(t.id, mid))
        .update({
          data: { status: 'cancelled', updatedAt: now, reviewedAt: now },
        })
    }
  }
}

async function fetchMemberBriefs(memberIds) {
  const ids = [...new Set((memberIds || []).map(String).filter(Boolean))]
  const list = []
  for (const id of ids) {
    const m = await getMemberRaw(id)
    list.push({
      memberId: id,
      characterName: (m && m.characterName) || id,
      pathway: (m && m.pathway) || '',
      powerScore: m && typeof m.powerScore === 'number' ? m.powerScore : null,
    })
  }
  return list
}

function summarizeTeam(team, { myMemberId = null, myApp = null } = {}) {
  const memberIds = Array.isArray(team.memberIds) ? team.memberIds.map(String) : []
  const mid = myMemberId ? String(myMemberId) : null
  return {
    ...team,
    memberCount: memberIds.length,
    myInTeam: mid ? memberIds.includes(mid) : false,
    myIsLeader: mid ? String(team.leaderMemberId) === mid : false,
    myApplicationStatus: myApp && APP_STATUSES.has(myApp.status) ? myApp.status : null,
  }
}

async function attachLeaderPathway(teams) {
  const list = Array.isArray(teams) ? teams : []
  if (!list.length) return list
  const ids = [...new Set(list.map((t) => String(t.leaderMemberId || '')).filter(Boolean))]
  const briefs = await fetchMemberBriefs(ids)
  const pathMap = new Map(briefs.map((b) => [String(b.memberId), b.pathway || '']))
  return list.map((t) => ({
    ...t,
    leaderPathway: pathMap.get(String(t.leaderMemberId || '')) || '',
  }))
}

/**
 * @param {string} activityId
 * @param {string} viewerMemberId
 * @param {{ timeFilter?: string, mineFilter?: string }} [opts]
 *   timeFilter: today|week（tonight 兼容）；mineFilter: created|joined
 */
async function listTeamsByActivity(activityId, viewerMemberId, opts = {}) {
  await ensureCollections()
  const aid = String(activityId || '').trim()
  if (!aid) throw err('缺少活动 id', 400)
  const timeFilter = String(opts.timeFilter || '').trim()
  const mineFilter = String(opts.mineFilter || opts.filter || '').trim()
  let teams = (await listTeamsByActivityId(aid)).filter(
    (t) => !HIDDEN_LIST_STATUSES.has(t.status),
  )
  let activityDateKey = ''
  if (timeFilter) {
    try {
      const actRes = await db().collection(ACTIVITIES).doc(aid).get()
      const actRaw = Array.isArray(actRes.data) ? actRes.data[0] : actRes.data
      const act = toClient(actRaw)
      if (act) {
        const occ = resolveOccurrence(act)
        activityDateKey = occ.dateKey || ''
        if (!activityDateKey && act.startAt) {
          activityDateKey = shanghaiYmd(new Date(act.startAt))
        }
      }
    } catch {
      /* ignore */
    }
    teams = teams.filter((t) => matchTeamTimeFilter(t.startAt, timeFilter, activityDateKey))
  }
  teams.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const out = []
  for (const t of teams) {
    const myApp = viewerMemberId ? await getApplication(t.id, viewerMemberId) : null
    const row = summarizeTeam(t, { myMemberId: viewerMemberId, myApp })
    if (mineFilter === 'created' && !row.myIsLeader) continue
    if (mineFilter === 'joined' && !row.myInTeam) continue
    out.push(row)
  }
  return attachLeaderPathway(out)
}

async function getTeamDetail(teamId, viewerMemberId) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  const myApp = viewerMemberId ? await getApplication(team.id, viewerMemberId) : null
  const summary = summarizeTeam(team, { myMemberId: viewerMemberId, myApp })
  const members = await fetchMemberBriefs(team.memberIds)
  const isLeader = viewerMemberId && String(team.leaderMemberId) === String(viewerMemberId)
  let pendingApplications = []
  if (isLeader && MANAGE_TEAM_STATUSES.has(team.status)) {
    const pending = await listPendingByTeam(team.id)
    pendingApplications = await Promise.all(
      pending.map(async (row) => {
        const m = await getMemberRaw(row.memberId)
        return {
          ...row,
          characterName: row.characterName || (m && m.characterName) || row.memberId,
          pathway: (m && m.pathway) || '',
          powerScore: m && typeof m.powerScore === 'number' ? m.powerScore : null,
        }
      }),
    )
  }
  const leader = members.find((m) => String(m.memberId) === String(team.leaderMemberId))
  return {
    ...summary,
    leaderPathway: (leader && leader.pathway) || '',
    members,
    pendingApplications,
    myApplication: myApp,
  }
}

async function createTeam(payload, actorMember) {
  await ensureCollections()
  const activityId = String(payload.activityId || '').trim()
  if (!activityId) throw err('缺少活动 id', 400)
  // 产品：创建页不再填副本/模式；默认用队长角色名（可仍传 modeName 覆盖）
  const modeName =
    String(payload.modeName || '').trim() ||
    String(actorMember.characterName || '').trim() ||
    '队伍'
  // 创建默认 6（与小程序建队表单一致）；显式传入则校验 ≥ 2
  const maxRaw = payload.maxMembers
  const maxMembers =
    maxRaw === undefined || maxRaw === null || maxRaw === ''
      ? 6
      : Math.round(Number(maxRaw))
  if (!Number.isFinite(maxMembers) || maxMembers < 2) {
    throw err('人数上限至少为 2', 400)
  }

  const activity = await getActivityRaw(activityId)
  assertCanWriteOnActivity(activity, { needEnableTeam: true })

  const existing = await findMembershipOnActivity(activityId, actorMember.id)
  if (existing) throw err('你已在本活动的一支队伍中', 409)

  let startAt
  if (payload.startAt !== undefined) {
    startAt = parseStartAt(payload.startAt)
  } else if (activity.startAt) {
    startAt = parseStartAt(activity.startAt)
  } else {
    startAt = null
  }

  let minPowerScore = null
  if (payload.minPowerScore !== undefined && payload.minPowerScore !== null && payload.minPowerScore !== '') {
    const n = Number(payload.minPowerScore)
    if (!Number.isFinite(n) || n < 0) throw err('要求评分无效', 400)
    minPowerScore = Math.round(n)
  }

  const now = nowIso()
  const row = {
    activityId,
    modeName,
    startAt,
    maxMembers,
    minPowerScore,
    remark: String(payload.remark || '').trim(),
    leaderMemberId: String(actorMember.id),
    leaderCharacterName: String(actorMember.characterName || '').trim(),
    memberIds: [String(actorMember.id)],
    status: 'recruiting',
    createdAt: now,
    updatedAt: now,
  }

  const addRes = await db().collection(TEAMS).add({ data: row })
  const id = addRes._id || addRes.id
  return summarizeTeam({ id, ...row }, { myMemberId: actorMember.id })
}

async function updateTeam(teamId, payload, actorMemberId) {
  const team = await getTeam(teamId)
  assertManageableTeam(team)
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可修改队伍', 403)
  }

  const activity = await getActivityRaw(team.activityId)
  assertCanWriteOnActivity(activity, { needEnableTeam: false })
  if (!activity.enableTeam) throw err('该活动未开启组队，无法修改', 409)

  const patch = { updatedAt: nowIso() }

  if (payload.modeName !== undefined) {
    const modeName = String(payload.modeName || '').trim()
    if (!modeName) throw err('副本/模式不能为空', 400)
    patch.modeName = modeName
  }
  if (payload.remark !== undefined) {
    patch.remark = String(payload.remark || '').trim()
  }
  if (payload.startAt !== undefined) {
    patch.startAt = parseStartAt(payload.startAt)
  }
  if (payload.minPowerScore !== undefined) {
    if (payload.minPowerScore === null || payload.minPowerScore === '') {
      patch.minPowerScore = null
    } else {
      const n = Number(payload.minPowerScore)
      if (!Number.isFinite(n) || n < 0) throw err('要求评分无效', 400)
      patch.minPowerScore = Math.round(n)
    }
  }
  if (payload.maxMembers !== undefined) {
    const maxMembers = Math.round(Number(payload.maxMembers))
    if (!Number.isFinite(maxMembers) || maxMembers < 2) {
      throw err('人数上限至少为 2', 400)
    }
    const count = (team.memberIds || []).length
    if (maxMembers < count) throw err(`人数上限不能小于当前人数（${count}）`, 400)
    patch.maxMembers = maxMembers
    patch.status = deriveTeamStatus(team.memberIds, maxMembers, team.status)
  }

  await db().collection(TEAMS).doc(String(teamId)).update({ data: patch })
  return getTeamDetail(teamId, actorMemberId)
}

async function applyTeam(teamId, message, actorMember) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  if (team.status !== 'recruiting') {
    throw err(team.status === 'full' ? '队伍已满员' : '队伍当前不可申请', 409)
  }

  const activity = await getActivityRaw(team.activityId)
  assertCanWriteOnActivity(activity, { needEnableTeam: true })

  const mid = String(actorMember.id)
  if ((team.memberIds || []).map(String).includes(mid)) {
    throw err('你已在该队伍中', 409)
  }
  const other = await findMembershipOnActivity(team.activityId, mid)
  if (other) throw err('你已在本活动的另一支队伍中', 409)

  if (team.minPowerScore != null) {
    const score = Number(actorMember.powerScore)
    if (!Number.isFinite(score) || score < team.minPowerScore) {
      throw err(`评分不足（要求 ≥ ${team.minPowerScore}）`, 403)
    }
  }

  const existing = await getApplication(teamId, mid)
  if (existing && existing.status === 'pending') {
    throw err('已有待审批申请', 409)
  }

  const now = nowIso()
  const row = {
    teamId: String(teamId),
    memberId: mid,
    characterName: String(actorMember.characterName || '').trim(),
    message: String(message || '').trim(),
    status: 'pending',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    reviewedAt: null,
  }
  await db()
    .collection(APPS)
    .doc(appDocId(teamId, mid))
    .set({ data: row })

  return getTeamDetail(teamId, mid)
}

async function cancelTeamApplication(teamId, actorMemberId) {
  const app = await getApplication(teamId, actorMemberId)
  if (!app || app.status !== 'pending') {
    throw err('没有可撤回的申请', 409)
  }
  const now = nowIso()
  await db()
    .collection(APPS)
    .doc(appDocId(teamId, actorMemberId))
    .update({ data: { status: 'cancelled', updatedAt: now } })
  return getTeamDetail(teamId, actorMemberId)
}

async function reviewTeamApplication(teamId, targetMemberId, decision, actorMemberId) {
  const team = await getTeam(teamId)
  assertManageableTeam(team)
  if (team.status === 'paused' && String(decision || '').trim() === 'approve') {
    throw err('已关闭招募，请先开启招募再通过申请', 409)
  }
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可审批', 403)
  }

  const activity = await getActivityRaw(team.activityId)
  assertCanWriteOnActivity(activity, { needEnableTeam: true })

  const mid = String(targetMemberId || '').trim()
  if (!mid) throw err('缺少成员 id', 400)
  const dec = String(decision || '').trim()
  if (dec !== 'approve' && dec !== 'reject') {
    throw err('decision 须为 approve 或 reject', 400)
  }

  const app = await getApplication(teamId, mid)
  if (!app || app.status !== 'pending') throw err('没有待审批申请', 409)

  const now = nowIso()
  if (dec === 'reject') {
    await db()
      .collection(APPS)
      .doc(appDocId(teamId, mid))
      .update({ data: { status: 'rejected', reviewedAt: now, updatedAt: now } })
    return getTeamDetail(teamId, actorMemberId)
  }

  // approve
  if (team.status === 'full' || (team.memberIds || []).length >= team.maxMembers) {
    throw err('队伍已满，无法通过', 409)
  }
  const other = await findMembershipOnActivity(team.activityId, mid)
  if (other && String(other.id) !== String(teamId)) {
    throw err('该成员已在本活动其他队伍中', 409)
  }

  const memberIds = [...(team.memberIds || []).map(String), mid]
  const status = deriveTeamStatus(memberIds, team.maxMembers, team.status)

  await db()
    .collection(APPS)
    .doc(appDocId(teamId, mid))
    .update({ data: { status: 'approved', reviewedAt: now, updatedAt: now } })
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { memberIds, status, updatedAt: now } })
  await cancelOtherPendingOnActivity(team.activityId, mid, teamId)

  return getTeamDetail(teamId, actorMemberId)
}

async function kickTeamMember(teamId, targetMemberId, actorMemberId) {
  const team = await getTeam(teamId)
  assertManageableTeam(team)
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可踢人', 403)
  }
  const mid = String(targetMemberId || '').trim()
  if (!mid) throw err('缺少成员 id', 400)
  if (mid === String(actorMemberId)) throw err('不能踢出自己', 400)
  if (mid === String(team.leaderMemberId)) throw err('不能踢出队长', 400)

  const memberIds = (team.memberIds || []).map(String)
  if (!memberIds.includes(mid)) throw err('该成员不在队伍中', 404)

  const nextIds = memberIds.filter((id) => id !== mid)
  const status = deriveTeamStatus(nextIds, team.maxMembers, team.status)
  const now = nowIso()

  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { memberIds: nextIds, status, updatedAt: now } })

  const app = await getApplication(teamId, mid)
  if (app) {
    await db()
      .collection(APPS)
      .doc(appDocId(teamId, mid))
      .update({ data: { status: 'kicked', reviewedAt: now, updatedAt: now } })
  } else {
    await db()
      .collection(APPS)
      .doc(appDocId(teamId, mid))
      .set({
        data: {
          teamId: String(teamId),
          memberId: mid,
          characterName: '',
          message: '',
          status: 'kicked',
          createdAt: now,
          updatedAt: now,
          reviewedAt: now,
        },
      })
  }

  return getTeamDetail(teamId, actorMemberId)
}

async function leaveTeam(teamId, actorMemberId) {
  const team = await getTeam(teamId)
  assertManageableTeam(team)
  const mid = String(actorMemberId)
  if (String(team.leaderMemberId) === mid) {
    throw err('队长请先转让队长或关闭队伍', 409)
  }
  const memberIds = (team.memberIds || []).map(String)
  if (!memberIds.includes(mid)) throw err('你不在该队伍中', 404)

  const nextIds = memberIds.filter((id) => id !== mid)
  const status = deriveTeamStatus(nextIds, team.maxMembers, team.status)
  const now = nowIso()

  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { memberIds: nextIds, status, updatedAt: now } })

  const app = await getApplication(teamId, mid)
  if (app) {
    await db()
      .collection(APPS)
      .doc(appDocId(teamId, mid))
      .update({ data: { status: 'cancelled', updatedAt: now } })
  }

  return getTeamDetail(teamId, actorMemberId)
}

async function transferTeamLeader(teamId, targetMemberId, actorMemberId) {
  const team = await getTeam(teamId)
  assertManageableTeam(team)
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可转让', 403)
  }
  const mid = String(targetMemberId || '').trim()
  if (!mid) throw err('缺少成员 id', 400)
  if (mid === String(actorMemberId)) throw err('不能转让给自己', 400)
  const memberIds = (team.memberIds || []).map(String)
  if (!memberIds.includes(mid)) throw err('目标须已在队伍中', 400)

  const target = await getMemberRaw(mid)
  const now = nowIso()
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({
      data: {
        leaderMemberId: mid,
        leaderCharacterName: (target && target.characterName) || '',
        updatedAt: now,
      },
    })
  return getTeamDetail(teamId, actorMemberId)
}

/** 关闭招募：仍在列表，不可新申请，可再开 */
async function pauseTeamRecruiting(teamId, actorMemberId) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  if (!RECRUIT_OPEN_STATUSES.has(team.status)) {
    throw err(team.status === 'paused' ? '已关闭招募' : '当前无法关闭招募', 409)
  }
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可关闭招募', 403)
  }
  const now = nowIso()
  await rejectAllPending(teamId, '已关闭招募')
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { status: 'paused', updatedAt: now } })
  return getTeamDetail(teamId, actorMemberId)
}

/** 开启招募：paused → recruiting/full */
async function resumeTeamRecruiting(teamId, actorMemberId) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  if (team.status !== 'paused') {
    throw err('仅「已关招募」的队伍可再次开启', 409)
  }
  if (String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可开启招募', 403)
  }
  const activity = await getActivityRaw(team.activityId)
  assertCanWriteOnActivity(activity, { needEnableTeam: true })
  const status = deriveTeamStatus(team.memberIds, team.maxMembers, 'recruiting')
  const now = nowIso()
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { status, updatedAt: now } })
  return getTeamDetail(teamId, actorMemberId)
}

/** 撤销队伍：解散并从活动队伍列表隐藏 */
/** 周期换场：将该活动下未隐藏队伍全部 dissolved */
async function dissolveAllByActivity(activityId) {
  const teams = await listTeamsByActivityId(activityId)
  const now = new Date().toISOString()
  let n = 0
  for (const t of teams) {
    if (HIDDEN_LIST_STATUSES.has(t.status)) continue
    try {
      await db()
        .collection(TEAMS)
        .doc(String(t.id))
        .update({ data: { status: 'dissolved', updatedAt: now } })
      n += 1
    } catch (e) {
      console.warn('[teamsDb] dissolveAllByActivity', t.id, e?.message || e)
    }
  }
  return n
}

/**
 * 活动结束/取消：关闭仍在招募的队伍（reject pending → dissolved）。
 * 已 started / dissolved 不动。与管理端 closeTeamsForActivity 对齐。
 */
async function closeActiveTeamsByActivity(activityId, reasonNote = '活动已结束') {
  const teams = await listTeamsByActivityId(activityId)
  const now = nowIso()
  let n = 0
  for (const t of teams) {
    if (!MANAGE_TEAM_STATUSES.has(t.status)) continue
    try {
      await rejectAllPending(t.id, reasonNote)
      await db()
        .collection(TEAMS)
        .doc(String(t.id))
        .update({ data: { status: 'dissolved', updatedAt: now } })
      n += 1
    } catch (e) {
      console.warn('[teamsDb] closeActiveTeamsByActivity', t.id, e?.message || e)
    }
  }
  return n
}

async function dissolveTeam(teamId, actorMemberId, { asAdmin = false } = {}) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  if (HIDDEN_LIST_STATUSES.has(team.status) || team.status === 'started') {
    throw err('队伍已结束，无法撤销', 409)
  }
  if (!asAdmin && String(team.leaderMemberId) !== String(actorMemberId)) {
    throw err('仅队长可撤销队伍', 403)
  }
  const now = nowIso()
  await rejectAllPending(teamId, asAdmin ? '管理员强制解散' : '队伍已撤销')
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { status: 'dissolved', updatedAt: now } })

  if (asAdmin) {
    return getTeam(teamId)
  }
  return getTeamDetail(teamId, actorMemberId)
}

/** @deprecated 兼容旧 action：等同 dissolveTeam */
async function closeTeam(teamId, actorMemberId, opts) {
  return dissolveTeam(teamId, actorMemberId, opts)
}

/** 手动/定时：到点 → started */
async function markTeamStarted(teamId) {
  const team = await getTeam(teamId)
  if (!team) throw err('队伍不存在', 404)
  if (!STARTABLE_STATUSES.has(team.status)) {
    return team
  }
  const now = nowIso()
  await rejectAllPending(teamId, '已开始')
  await db()
    .collection(TEAMS)
    .doc(String(teamId))
    .update({ data: { status: 'started', updatedAt: now } })
  return getTeam(teamId)
}

async function expireTeamsDue(now = new Date()) {
  await ensureCollections()
  const teams = await fetchAll(TEAMS)
  const ts = now.getTime()
  const done = []
  for (const t of teams) {
    if (!STARTABLE_STATUSES.has(t.status)) continue
    if (!t.startAt) continue
    const start = new Date(t.startAt).getTime()
    if (Number.isNaN(start) || start > ts) continue
    await markTeamStarted(t.id)
    done.push(t.id)
  }
  return { expired: done }
}

/**
 * @param {string} memberId
 * @param {string|object} [filterOrOpts] filter=created|joined，或 { filter, mineFilter, timeFilter }
 */
async function listMyTeams(memberId, filterOrOpts) {
  await ensureCollections()
  const mid = String(memberId)
  const opts =
    filterOrOpts && typeof filterOrOpts === 'object'
      ? filterOrOpts
      : { filter: filterOrOpts }
  const mineFilter = String(opts.mineFilter || opts.filter || '').trim()
  const timeFilter = String(opts.timeFilter || '').trim()
  const all = await fetchAll(TEAMS)
  let rows = all.filter((t) => {
    if (HIDDEN_LIST_STATUSES.has(t.status)) return false
    const ids = (t.memberIds || []).map(String)
    const isLeader = String(t.leaderMemberId) === mid
    const joined = ids.includes(mid)
    if (mineFilter === 'created') return isLeader
    if (mineFilter === 'joined') return joined
    return joined
  })
  if (timeFilter) {
    rows = rows.filter((t) => matchTeamTimeFilter(t.startAt, timeFilter))
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return attachLeaderPathway(rows.map((t) => summarizeTeam(t, { myMemberId: mid })))
}

/** 我任队长且可管理的队伍上，待审批申请汇总 */
async function listPendingApprovalsForLeader(memberId) {
  await ensureCollections()
  const mid = String(memberId || '').trim()
  if (!mid) return { pendingApprovalCount: 0, pendingTeams: [] }
  const all = await fetchAll(TEAMS)
  const led = all.filter(
    (t) =>
      String(t.leaderMemberId) === mid &&
      !HIDDEN_LIST_STATUSES.has(t.status) &&
      MANAGE_TEAM_STATUSES.has(t.status),
  )
  const pendingTeams = []
  let pendingApprovalCount = 0
  for (const t of led) {
    const pending = await listPendingByTeam(t.id)
    if (!pending.length) continue
    pendingApprovalCount += pending.length
    pendingTeams.push({
      teamId: t.id,
      activityId: t.activityId,
      modeName: t.modeName || '',
      pendingCount: pending.length,
    })
  }
  return { pendingApprovalCount, pendingTeams }
}

/** 管理端列表 */
async function adminListTeams({ activityId, status } = {}) {
  await ensureCollections()
  let rows = await fetchAll(TEAMS)
  if (activityId) rows = rows.filter((t) => String(t.activityId) === String(activityId))
  if (status && TEAM_STATUSES.has(String(status))) {
    rows = rows.filter((t) => t.status === status)
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return rows.map((t) => ({
    ...t,
    memberCount: Array.isArray(t.memberIds) ? t.memberIds.length : 0,
  }))
}

module.exports = {
  TEAM_STATUSES,
  APP_STATUSES,
  ensureCollections,
  getTeam,
  listTeamsByActivity,
  getTeamDetail,
  createTeam,
  updateTeam,
  applyTeam,
  cancelTeamApplication,
  reviewTeamApplication,
  kickTeamMember,
  leaveTeam,
  transferTeamLeader,
  pauseTeamRecruiting,
  resumeTeamRecruiting,
  dissolveTeam,
  dissolveAllByActivity,
  closeActiveTeamsByActivity,
  closeTeam,
  markTeamStarted,
  expireTeamsDue,
  listMyTeams,
  listPendingApprovalsForLeader,
  adminListTeams,
}
