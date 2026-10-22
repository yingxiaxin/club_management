/**
 * 云库 invite_codes / join_applications（管理端本机 API）
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const INVITES = 'invite_codes'
const APPS = 'join_applications'
const USERS = 'users'
const ADMIN_ROLES = new Set(['admin', 'super_admin'])

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
      console.warn('[cloudInvites] createCollection', name, res.code, res.message)
    }
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudInvites] createCollection', name, msg)
    }
  }
}

/** 首次用邀请码接口时自动建集合（避免 ResourceNotFound） */
export async function ensureInviteCollections() {
  if (collectionsReady) return
  await ensureCollection(INVITES)
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

async function fetchAll(collection) {
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await database.collection(collection).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all.map(toClient)
}

function genCode() {
  return `I${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 12)
}

export async function listInviteCodes() {
  await ensureInviteCollections()
  const list = await fetchAll(INVITES)
  list.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bt - at
  })
  return list
}

export async function createInviteCode(payload = {}, createdBy = 'admin') {
  await ensureInviteCollections()
  const code = String(payload.code || genCode()).trim().toUpperCase()
  if (!code) throw err('邀请码不能为空', 400)
  const existing = (await fetchAll(INVITES)).find((r) => r.code === code)
  if (existing) throw err('邀请码已存在', 409)

  let maxUses = Number(payload.maxUses)
  if (!Number.isFinite(maxUses) || maxUses < 1) maxUses = 50
  let expiresAt = null
  if (payload.expiresAt) {
    const d = new Date(payload.expiresAt)
    if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString()
  }
  const now = new Date().toISOString()
  const id = `inv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const row = {
    code,
    maxUses,
    usedCount: 0,
    expiresAt,
    enabled: payload.enabled !== false,
    createdBy: String(createdBy || 'admin'),
    createdAt: now,
  }
  await getDb().collection(INVITES).doc(id).set(row)
  return { id, ...row }
}

export async function updateInviteCode(id, payload = {}) {
  await ensureInviteCollections()
  let row
  try {
    const res = await getDb().collection(INVITES).doc(String(id)).get()
    row = toClient(Array.isArray(res.data) ? res.data[0] : res.data)
  } catch {
    row = null
  }
  if (!row) throw err('邀请码不存在', 404)

  const patch = {}
  if (payload.enabled !== undefined) patch.enabled = Boolean(payload.enabled)
  if (payload.maxUses !== undefined) {
    const n = Number(payload.maxUses)
    if (!Number.isFinite(n) || n < 1) throw err('次数上限无效', 400)
    patch.maxUses = n
  }
  if (payload.expiresAt !== undefined) {
    if (!payload.expiresAt) patch.expiresAt = null
    else {
      const d = new Date(payload.expiresAt)
      if (Number.isNaN(d.getTime())) throw err('过期时间无效', 400)
      patch.expiresAt = d.toISOString()
    }
  }
  if (!Object.keys(patch).length) return row
  await getDb().collection(INVITES).doc(String(id)).update(patch)
  return { ...row, ...patch }
}

export async function listApplications({ status } = {}) {
  await ensureInviteCollections()
  let list = await fetchAll(APPS)
  if (status) list = list.filter((a) => a.status === status)
  list.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bt - at
  })
  return list
}

async function getApplication(id) {
  try {
    const res = await getDb().collection(APPS).doc(String(id)).get()
    return toClient(Array.isArray(res.data) ? res.data[0] : res.data)
  } catch {
    return null
  }
}

async function getInvite(id) {
  try {
    const res = await getDb().collection(INVITES).doc(String(id)).get()
    return toClient(Array.isArray(res.data) ? res.data[0] : res.data)
  } catch {
    return null
  }
}

async function findInviteByCode(code) {
  const list = await fetchAll(INVITES)
  return list.find((r) => r.code === String(code || '').trim()) || null
}

function assertInviteUsable(invite) {
  if (!invite) throw err('邀请码不存在', 404)
  if (invite.enabled === false) throw err('邀请码已停用', 410)
  if (invite.expiresAt) {
    const exp = new Date(invite.expiresAt).getTime()
    if (exp && Date.now() > exp) throw err('邀请码已过期', 410)
  }
  const max = Number(invite.maxUses)
  const used = Number(invite.usedCount) || 0
  if (Number.isFinite(max) && max > 0 && used >= max) {
    throw err('邀请码已达使用次数上限', 410)
  }
}

async function attachUserToMember(openid, member) {
  const col = getDb().collection(USERS)
  let res = await col.where({ openid }).limit(1).get()
  let row = (res.data || [])[0]
  if (!row) {
    res = await col.where({ _openid: openid }).limit(1).get()
    row = (res.data || [])[0]
  }
  const patch = {
    memberId: member.id,
    displayName: member.characterName,
    lastLoginAt: new Date(),
  }
  if (row) {
    const role = row.role || 'guest'
    if (!ADMIN_ROLES.has(role)) patch.role = 'member'
    await col.doc(row._id).update(patch)
  } else {
    await col.add({
      openid,
      role: 'member',
      displayName: member.characterName,
      memberId: member.id,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    })
  }
}

/**
 * @param {string} id
 * @param {{ decision: 'approved'|'rejected', reviewer?: string }} opts
 */
export async function reviewApplication(id, { decision, reviewer } = {}) {
  await ensureInviteCollections()
  if (!['approved', 'rejected'].includes(decision)) {
    throw err('decision 须为 approved 或 rejected', 400)
  }
  const appRow = await getApplication(id)
  if (!appRow) throw err('申请不存在', 404)
  if (appRow.status !== 'pending') throw err('该申请已处理', 409)

  const now = new Date().toISOString()
  if (decision === 'rejected') {
    const patch = {
      status: 'rejected',
      reviewedBy: String(reviewer || 'admin'),
      reviewedAt: now,
    }
    await getDb().collection(APPS).doc(String(id)).update(patch)
    return { ...appRow, ...patch }
  }

  // approve：关联已有成员微信，不新建档案
  let invite = appRow.inviteId ? await getInvite(appRow.inviteId) : null
  if (!invite) invite = await findInviteByCode(appRow.inviteCode)
  assertInviteUsable(invite)

  const name = String(appRow.characterName || '').trim()
  if (!name) throw err('申请缺少角色名', 400)

  let member = null
  if (appRow.memberId) {
    member = await cloudMembers.getMember(appRow.memberId)
  }
  if (!member || member.status === 'left') {
    member = await cloudMembers.findActiveByName(name)
  }
  if (!member || member.status === 'left') {
    throw err('名单中无此角色，无法关联（成员须先由管理端录入）', 404)
  }
  if (member.boundOpenid && member.boundOpenid !== appRow.openid) {
    throw err('该角色已关联其他微信', 409)
  }

  member = await cloudMembers.updateMember(member.id, {
    boundOpenid: appRow.openid,
  })
  await attachUserToMember(appRow.openid, member)

  await getDb()
    .collection(INVITES)
    .doc(String(invite.id))
    .update({ usedCount: (Number(invite.usedCount) || 0) + 1 })

  const patch = {
    status: 'approved',
    reviewedBy: String(reviewer || 'admin'),
    reviewedAt: now,
    memberId: member.id,
  }
  await getDb().collection(APPS).doc(String(id)).update(patch)
  return { ...appRow, ...patch, member }
}
