/**
 * 云库 users：任命/撤销管理员、列表附带 accountRole。
 * 仅改 role；不解除 members.boundOpenid / users.memberId。
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const USERS = 'users'

let app = null

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

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

/** @param {string} openid */
async function findUserDocsByOpenid(openid) {
  if (!openid) return []
  const col = getDb().collection(USERS)
  const byId = new Map()
  const remember = (rows) => {
    for (const row of rows || []) {
      if (row?._id) byId.set(row._id, row)
    }
  }
  try {
    const a = await col.where({ openid }).limit(5).get()
    remember(a.data)
  } catch {
    /* ignore */
  }
  try {
    const b = await col.where({ _openid: openid }).limit(5).get()
    remember(b.data)
  } catch {
    /* ignore */
  }
  return [...byId.values()]
}

/** 取该 openid 下「最强」角色（超管 > 管理员 > 成员 > guest） */
function pickPrimaryRole(docs) {
  if (!docs.length) return null
  const rank = { super_admin: 4, admin: 3, member: 2, guest: 1 }
  let best = docs[0]
  let bestRank = rank[best.role] || 0
  for (const d of docs.slice(1)) {
    const r = rank[d.role] || 0
    if (r > bestRank) {
      best = d
      bestRank = r
    }
  }
  return best.role || null
}

/**
 * 为成员列表附加 accountRole：
 * - 无 boundOpenid → null（前端显示「未关联」）
 * - 有绑定但无 users → null（前端按 boundOpenid 显示「成员」）
 * - 否则为 users.role
 * - 兜底：members 缺 boundOpenid 但 users.memberId 已指向该成员时，用 users 反填展示（避免「已关联却显示未关联」）
 */
export async function attachAccountRoles(members) {
  const list = members || []
  const openids = [
    ...new Set(list.map((m) => m.boundOpenid).filter(Boolean).map(String)),
  ]
  const roleByOpenid = new Map()
  const col = getDb().collection(USERS)
  const _ = getDb().command
  if (openids.length) {
    const byId = new Map()
    const remember = (rows) => {
      for (const row of rows || []) {
        if (row?._id) byId.set(row._id, row)
      }
    }
    // 分批 _.in，避免单次过长
    const chunkSize = 50
    for (let i = 0; i < openids.length; i += chunkSize) {
      const chunk = openids.slice(i, i + chunkSize)
      try {
        const a = await col.where({ openid: _.in(chunk) }).limit(100).get()
        remember(a.data)
      } catch {
        /* ignore */
      }
      try {
        const b = await col.where({ _openid: _.in(chunk) }).limit(100).get()
        remember(b.data)
      } catch {
        /* ignore */
      }
    }
    const grouped = new Map()
    for (const row of byId.values()) {
      const oid = String(row.openid || row._openid || '')
      if (!oid) continue
      if (!grouped.has(oid)) grouped.set(oid, [])
      grouped.get(oid).push(row)
    }
    for (const oid of openids) {
      roleByOpenid.set(oid, pickPrimaryRole(grouped.get(oid) || []))
    }
  }

  // 反查：无 boundOpenid 的成员，看是否有 users.memberId 指向自己
  const missing = list.filter((m) => !m.boundOpenid && m.id)
  if (missing.length) {
    const byMemberId = new Map()
    const chunkSize = 50
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize).map((m) => String(m.id))
      try {
        const res = await col.where({ memberId: _.in(chunk) }).limit(100).get()
        for (const row of res.data || []) {
          if (!row?.memberId) continue
          const mid = String(row.memberId)
          if (!byMemberId.has(mid)) byMemberId.set(mid, [])
          byMemberId.get(mid).push(row)
        }
      } catch {
        /* ignore */
      }
    }
    for (const m of missing) {
      const docs = byMemberId.get(String(m.id)) || []
      if (!docs.length) continue
      const primary = docs.slice().sort((a, b) => {
        const rank = { super_admin: 4, admin: 3, member: 2, guest: 1 }
        return (rank[b.role] || 0) - (rank[a.role] || 0)
      })[0]
      const oid = String(primary.openid || primary._openid || '')
      if (!oid) continue
      m.boundOpenid = oid
      m.accountRole = primary.role || null
      // 异步修补库内不一致（不阻塞列表）
      cloudMembers
        .updateMember(m.id, { boundOpenid: oid })
        .catch(() => {})
    }
  }

  for (const m of list) {
    if (!m.boundOpenid) {
      m.accountRole = null
    } else if (m.accountRole == null) {
      m.accountRole = roleByOpenid.get(String(m.boundOpenid)) || null
    }
  }
  return list
}

/**
 * 任命为 admin
 * @returns {Promise<object>} 成员 + accountRole
 */
export async function grantAdmin(memberId) {
  const member = await cloudMembers.getMember(memberId)
  if (!member || member.status === 'left') throw err('成员不存在', 404)
  const openid = member.boundOpenid
  if (!openid) {
    throw err('请先让该成员用邀请码关联微信', 400)
  }

  const docs = await findUserDocsByOpenid(openid)
  const primary = docs[0] ? docs.reduce((a, b) => {
    const rank = { super_admin: 4, admin: 3, member: 2, guest: 1 }
    return (rank[b.role] || 0) > (rank[a.role] || 0) ? b : a
  }) : null

  if (primary?.role === 'super_admin') {
    throw err('该微信已是超管，勿用本功能改', 409)
  }
  if (primary?.role === 'admin') {
    // 幂等：已是管理员
    return { ...member, accountRole: 'admin' }
  }

  const now = new Date()
  const col = getDb().collection(USERS)
  if (primary) {
    await col.doc(primary._id).update({
      role: 'admin',
      memberId: member.id,
      displayName: member.characterName,
      lastLoginAt: now,
    })
  } else {
    await col.add({
      openid,
      role: 'admin',
      memberId: member.id,
      displayName: member.characterName,
      createdAt: now,
      lastLoginAt: now,
    })
  }

  return { ...member, accountRole: 'admin' }
}

/**
 * 撤销 admin → member（有 memberId）或 guest
 * @returns {Promise<object>} 成员 + accountRole
 */
export async function revokeAdmin(memberId) {
  const member = await cloudMembers.getMember(memberId)
  if (!member || member.status === 'left') throw err('成员不存在', 404)
  const openid = member.boundOpenid
  if (!openid) {
    throw err('该成员未关联微信', 400)
  }

  const docs = await findUserDocsByOpenid(openid)
  if (!docs.length) {
    return { ...member, accountRole: null }
  }

  const hasSuper = docs.some((d) => d.role === 'super_admin')
  if (hasSuper) {
    throw err('不可撤销超管身份', 403)
  }

  const adminDocs = docs.filter((d) => d.role === 'admin')
  if (!adminDocs.length) {
    // 幂等
    const role = pickPrimaryRole(docs)
    return { ...member, accountRole: role }
  }

  const nextRole = member.id ? 'member' : 'guest'
  const col = getDb().collection(USERS)
  const now = new Date()
  for (const doc of adminDocs) {
    await col.doc(doc._id).update({
      role: nextRole,
      // 保留 memberId；同步展示名
      memberId: doc.memberId || member.id,
      displayName: member.characterName || doc.displayName,
      lastLoginAt: now,
    })
  }

  return { ...member, accountRole: nextRole }
}
