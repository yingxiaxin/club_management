/**
 * users：成员端身份与绑定
 */
const cloud = require('wx-server-sdk')

const USERS = 'users'
const ADMIN_ROLES = new Set(['admin', 'super_admin'])
const VIEW_ROLES = new Set(['member', 'admin', 'super_admin'])

function db() {
  return cloud.database()
}

function toUser(row, openid) {
  if (!row) return null
  return {
    id: row._id,
    openid: row.openid || row._openid || openid,
    role: row.role || 'guest',
    displayName: row.displayName || row.nickName || '',
    memberId: row.memberId || null,
  }
}

async function findByOpenid(openid) {
  if (!openid) return null
  const col = db().collection(USERS)
  let res = await col.where({ openid }).limit(1).get()
  let row = (res.data || [])[0]
  if (!row) {
    res = await col.where({ _openid: openid }).limit(1).get()
    row = (res.data || [])[0]
  }
  return toUser(row, openid)
}

async function ensureUser(openid) {
  const existing = await findByOpenid(openid)
  if (existing) {
    await db()
      .collection(USERS)
      .doc(existing.id)
      .update({ data: { lastLoginAt: new Date() } })
      .catch(() => {})
    return existing
  }
  const now = new Date()
  const doc = {
    openid,
    role: 'guest',
    displayName: '',
    memberId: null,
    createdAt: now,
    lastLoginAt: now,
  }
  const add = await db().collection(USERS).add({ data: doc })
  return {
    id: add._id,
    openid,
    role: 'guest',
    displayName: '',
    memberId: null,
  }
}

/**
 * 绑定成员后更新 users；不降级 admin / super_admin
 */
async function attachMember(openid, member) {
  const user = await ensureUser(openid)
  const patch = {
    memberId: member.id,
    displayName: member.characterName || user.displayName,
    lastLoginAt: new Date(),
  }
  if (!ADMIN_ROLES.has(user.role)) {
    patch.role = 'member'
  }
  await db().collection(USERS).doc(user.id).update({ data: patch })
  return {
    ...user,
    ...patch,
    role: patch.role || user.role,
  }
}

/**
 * 仅看 users 行：管理员恒可看；普通成员须仍挂着 memberId。
 * 调用方还应再校验对应 members 仍为 active（见 memberApi.resolveAccess）。
 */
function canViewMembers(user) {
  if (!user) return false
  if (ADMIN_ROLES.has(user.role)) return true
  return Boolean(user.memberId)
}

/**
 * 解除 users.memberId；非管理员降为 guest（移出/解绑后不再能看名单）。
 */
async function detachMember(openid) {
  const user = await ensureUser(openid)
  const prevMemberId = user.memberId
  const patch = {
    memberId: null,
    lastLoginAt: new Date(),
  }
  if (!ADMIN_ROLES.has(user.role)) {
    patch.role = 'guest'
  }
  await db().collection(USERS).doc(user.id).update({ data: patch })
  return {
    ...user,
    memberId: null,
    role: patch.role || user.role,
    prevMemberId,
  }
}

module.exports = {
  findByOpenid,
  ensureUser,
  attachMember,
  detachMember,
  canViewMembers,
  VIEW_ROLES,
  ADMIN_ROLES,
}
