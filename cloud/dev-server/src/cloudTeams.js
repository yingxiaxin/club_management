/**
 * 云库 teams / team_applications（管理端本机 API · P2-a）
 * 成员侧写操作在云函数 memberApi/teamsDb；此处提供总览与强制关闭 / 到点标记。
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const TEAMS = 'teams'
const APPS = 'team_applications'

const TEAM_STATUSES = new Set([
  'recruiting',
  'full',
  'paused',
  'started',
  'dissolved',
  'closed',
])
const STARTABLE = new Set(['recruiting', 'full', 'paused'])
const ACTIVE = new Set(['recruiting', 'full', 'paused'])

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
      console.warn('[cloudTeams] createCollection', name, res.code, res.message)
    }
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudTeams] createCollection', name, msg)
    }
  }
}

export async function ensureTeamCollections() {
  if (collectionsReady) return
  await ensureCollection(TEAMS)
  await ensureCollection(APPS)
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

function appDocId(teamId, memberId) {
  return `${String(teamId)}__${String(memberId)}`
}

function nowIso() {
  return new Date().toISOString()
}

async function fetchAll(collection, where = null) {
  await ensureTeamCollections()
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    let query = database.collection(collection)
    if (where) query = query.where(where)
    const res = await query.skip(offset).limit(pageSize).get()
    const rows = (res.data || []).map(toClient)
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

export async function getTeam(id) {
  await ensureTeamCollections()
  try {
    const res = await getDb().collection(TEAMS).doc(String(id)).get()
    const row = toClient(res.data)
    if (!row) return null
    return {
      ...row,
      memberCount: Array.isArray(row.memberIds) ? row.memberIds.length : 0,
    }
  } catch {
    return null
  }
}

export async function listTeams({ activityId, status } = {}) {
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

async function listPending(teamId) {
  const rows = await fetchAll(APPS, { teamId: String(teamId) })
  return rows.filter((r) => r.status === 'pending')
}

async function rejectPending(teamId, note) {
  const pending = await listPending(teamId)
  const now = nowIso()
  const database = getDb()
  await Promise.all(
    pending.map((row) =>
      database
        .collection(APPS)
        .doc(appDocId(teamId, row.memberId))
        .update({
          status: 'rejected',
          reviewedAt: now,
          reviewNote: note || '',
          updatedAt: now,
        }),
    ),
  )
}

/** 管理端强制解散（列表隐藏） */
export async function forceCloseTeam(id) {
  const team = await getTeam(id)
  if (!team) throw err('队伍不存在', 404)
  if (!ACTIVE.has(team.status)) throw err('队伍已结束，无需关闭', 409)
  const now = nowIso()
  await rejectPending(id, '管理员强制解散')
  await getDb().collection(TEAMS).doc(String(id)).update({
    status: 'dissolved',
    updatedAt: now,
  })
  return getTeam(id)
}

/** 活动 ended/cancelled 时解散下属活跃队伍 */
export async function closeTeamsForActivity(activityId) {
  const rows = await listTeams({ activityId: String(activityId) })
  const closed = []
  for (const t of rows) {
    if (!ACTIVE.has(t.status)) continue
    await forceCloseTeam(t.id)
    closed.push(t.id)
  }
  return { closed }
}

/** 测试/联调：手动标为已开始 */
export async function markTeamStarted(id) {
  const team = await getTeam(id)
  if (!team) throw err('队伍不存在', 404)
  if (!STARTABLE.has(team.status)) return team
  const now = nowIso()
  await rejectPending(id, '已开始')
  await getDb().collection(TEAMS).doc(String(id)).update({
    status: 'started',
    updatedAt: now,
  })
  return getTeam(id)
}

/** 扫到期队伍 → started（P2-d 定时前可 curl 测） */
export async function expireTeamsDue(now = new Date()) {
  const teams = await fetchAll(TEAMS)
  const ts = now.getTime()
  const expired = []
  for (const t of teams) {
    if (!STARTABLE.has(t.status) || !t.startAt) continue
    const start = new Date(t.startAt).getTime()
    if (Number.isNaN(start) || start > ts) continue
    await markTeamStarted(t.id)
    expired.push(t.id)
  }
  return { expired }
}

export async function getTeamDetail(id) {
  const team = await getTeam(id)
  if (!team) return null
  const apps = await fetchAll(APPS, { teamId: String(id) })
  return { ...team, applications: apps }
}
