/**
 * 成员端：邀请码 + 关联已有成员（角色名须与名单匹配，不新建档案）
 */
const cloud = require('wx-server-sdk')

const INVITES = 'invite_codes'
const APPS = 'join_applications'
const MEMBERS = 'members'

function db() {
  return cloud.database()
}

let collectionsReady = false

async function ensureInviteCollections() {
  if (collectionsReady) return
  const database = db()
  for (const name of [INVITES, APPS]) {
    try {
      await database.createCollection(name)
    } catch (e) {
      const msg = String(e?.message || e || '')
      if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
        console.warn('[invitesDb] createCollection', name, msg)
      }
    }
  }
  collectionsReady = true
}

function err(message, status = 400) {
  const e = new Error(message)
  e.status = status
  return e
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

async function findInviteByCode(code) {
  const key = String(code || '').trim()
  if (!key) return null
  const res = await db().collection(INVITES).where({ code: key }).limit(5).get()
  const rows = (res.data || []).map(toClient)
  return rows.find((r) => r.enabled !== false) || rows[0] || null
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
  return invite
}

async function findPendingByOpenid(openid) {
  const res = await db()
    .collection(APPS)
    .where({ openid, status: 'pending' })
    .limit(1)
    .get()
  return toClient((res.data || [])[0])
}

async function findLatestByOpenid(openid) {
  const res = await db().collection(APPS).where({ openid }).limit(20).get()
  const rows = (res.data || []).map(toClient)
  rows.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bt - at
  })
  return rows[0] || null
}

async function findActiveMemberByName(name) {
  const res = await db()
    .collection(MEMBERS)
    .where({ characterName: name, status: 'active' })
    .limit(1)
    .get()
  return toClient((res.data || [])[0])
}

async function findPendingByMemberId(memberId) {
  if (!memberId) return null
  const res = await db()
    .collection(APPS)
    .where({ memberId, status: 'pending' })
    .limit(5)
    .get()
  return (res.data || []).map(toClient)[0] || null
}

async function getMyApplication(openid) {
  if (!openid) throw err('无法获取微信身份', 401)
  await ensureInviteCollections()
  return findLatestByOpenid(openid)
}

/**
 * 邀请码关联：角色名必须已在俱乐部名单中；通过后只绑定微信，不新建成员。
 */
async function submitJoinApplication(openid, payload = {}) {
  if (!openid) throw err('无法获取微信身份', 401)
  await ensureInviteCollections()
  const inviteCode = String(payload.inviteCode || payload.code || '').trim()
  const characterName = String(payload.characterName || '').trim()
  const remark = String(payload.remark || '').trim()
  if (!inviteCode) throw err('请填写邀请码', 400)
  if (!characterName) throw err('请填写角色名', 400)

  const pending = await findPendingByOpenid(openid)
  if (pending) throw err('你已有待审核的关联申请，请等待管理员处理', 409)

  const invite = assertInviteUsable(await findInviteByCode(inviteCode))

  const member = await findActiveMemberByName(characterName)
  if (!member) {
    throw err('名单中无此角色名，请与管理员确认后再关联', 404)
  }
  if (member.boundOpenid && member.boundOpenid !== openid) {
    throw err('该角色已关联其他微信', 409)
  }
  if (member.boundOpenid === openid) {
    throw err('你已关联该角色', 409)
  }

  const otherPending = await findPendingByMemberId(member.id)
  if (otherPending && otherPending.openid !== openid) {
    throw err('该角色已有待审关联申请', 409)
  }

  const now = new Date().toISOString()
  const doc = {
    inviteCode: invite.code,
    inviteId: invite.id,
    openid,
    characterName: member.characterName,
    memberId: member.id,
    pathway: member.pathway || '',
    remark,
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
  }
  const add = await db().collection(APPS).add({ data: doc })
  return { id: add._id, ...doc }
}

module.exports = {
  getMyApplication,
  submitJoinApplication,
  findInviteByCode,
  assertInviteUsable,
}
