/**
 * 管理端扫码登录：login_tickets + users（openid → role）
 */
const cloud = require('wx-server-sdk')

const TICKETS = 'login_tickets'
const USERS = 'users'
const TTL_MS = 5 * 60 * 1000

function db() {
  return cloud.database()
}

function err(message, status = 400) {
  const e = new Error(message)
  e.status = status
  return e
}

function shortId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32)
}

function allowlist() {
  const raw = process.env.ADMIN_OPENIDS || ''
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function findAdminByOpenid(openid) {
  if (!openid) return null
  const col = db().collection(USERS)
  let res = await col.where({ openid }).limit(1).get()
  let row = (res.data || [])[0]
  if (!row) {
    res = await col.where({ _openid: openid }).limit(1).get()
    row = (res.data || [])[0]
  }
  if (!row) return null
  if (!['admin', 'super_admin'].includes(row.role)) return null
  return {
    id: row._id,
    openid: row.openid || row._openid || openid,
    role: row.role,
    displayName: row.displayName || row.nickName || '管理员',
  }
}

async function ensureAdminFromAllowlist(openid) {
  const existing = await findAdminByOpenid(openid)
  if (existing) return existing
  if (!allowlist().includes(openid)) return null
  const now = new Date()
  const doc = {
    openid,
    role: 'super_admin',
    displayName: '超管（扫码）',
    memberId: null,
    createdAt: now,
    lastLoginAt: now,
  }
  const add = await db().collection(USERS).add({ data: doc })
  return {
    id: add._id,
    openid,
    role: doc.role,
    displayName: doc.displayName,
  }
}

async function createAdminLoginTicket() {
  const ticketId = shortId()
  const now = Date.now()
  const expiresAt = new Date(now + TTL_MS)
  await db().collection(TICKETS).doc(ticketId).set({
    data: {
      status: 'pending',
      createdAt: new Date(now),
      expiresAt,
      openid: null,
      role: null,
      displayName: null,
      consumedAt: null,
    },
  })

  // 云函数 openapi 在部分环境下会 INVALID_WX_ACCESS_TOKEN；失败不阻断建票。
  // 本机 dev-server 可用 WECHAT_APP_SECRET 补生成小程序码；也可在小程序里手输票号。
  let qrBase64 = null
  let qrTip = null
  if (process.env.ENABLE_CLOUD_WXACODE === '1') {
    try {
      const envVersion = process.env.CLOUD_QR_ENV_VERSION || 'develop'
      const result = await cloud.openapi.wxacode.getUnlimited({
        scene: ticketId,
        page: 'pages/admin-login/index',
        checkPath: false,
        envVersion,
        width: 280,
      })
      const buf = result.buffer || result.Buffer
      if (buf) {
        const b64 = Buffer.from(buf).toString('base64')
        qrBase64 = `data:image/png;base64,${b64}`
      } else {
        qrTip = '小程序码未返回图片，请在小程序登录页输入票号'
      }
    } catch (e) {
      console.error('[createAdminLoginTicket] wxacode', e)
      qrTip = e.message || '云端小程序码失败，请手输票号或本机配置 WECHAT_APP_SECRET'
    }
  } else {
    qrTip = '请在小程序「管理端扫码登录」页输入票号确认；或配置 WECHAT_APP_SECRET 由本机出码'
  }

  return {
    ticketId,
    expiresAt: expiresAt.toISOString(),
    expireSeconds: Math.floor(TTL_MS / 1000),
    qrBase64,
    qrTip,
  }
}

async function getAdminLoginTicket(ticketId) {
  const id = String(ticketId || '').trim()
  if (!id) throw err('缺少 ticketId', 400)
  let row
  try {
    const res = await db().collection(TICKETS).doc(id).get()
    row = res.data
  } catch {
    throw err('登录票不存在', 404)
  }
  if (!row) throw err('登录票不存在', 404)

  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0
  if (row.status === 'pending' && exp && Date.now() > exp) {
    await db().collection(TICKETS).doc(id).update({ data: { status: 'expired' } })
    return { ticketId: id, status: 'expired' }
  }

  return {
    ticketId: id,
    status: row.status,
    role: row.role || null,
    displayName: row.displayName || null,
    openid: row.openid || null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  }
}

async function confirmAdminLogin(ticketId, openid) {
  const id = String(ticketId || '').trim()
  if (!id) throw err('缺少 ticketId', 400)
  if (!openid) throw err('无法获取微信身份', 401)

  const ticket = await getAdminLoginTicket(id)
  if (ticket.status === 'expired') throw err('二维码已过期，请刷新', 410)
  if (ticket.status === 'consumed') throw err('该登录已使用', 409)
  if (ticket.status === 'confirmed') {
    return { ticketId: id, status: 'confirmed', role: ticket.role, displayName: ticket.displayName }
  }
  if (ticket.status !== 'pending') throw err('登录票状态异常', 409)

  let admin = await findAdminByOpenid(openid)
  if (!admin) admin = await ensureAdminFromAllowlist(openid)
  if (!admin) {
    throw err('当前微信不是管理员。请先用应急账号登录，或将 openid 加入 users / ADMIN_OPENIDS', 403)
  }

  await db().collection(TICKETS).doc(id).update({
    data: {
      status: 'confirmed',
      openid: admin.openid,
      role: admin.role,
      displayName: admin.displayName,
      confirmedAt: new Date(),
    },
  })
  await db()
    .collection(USERS)
    .doc(admin.id)
    .update({ data: { lastLoginAt: new Date() } })
    .catch(() => {})

  return {
    ticketId: id,
    status: 'confirmed',
    role: admin.role,
    displayName: admin.displayName,
  }
}

async function consumeAdminLoginTicket(ticketId) {
  const ticket = await getAdminLoginTicket(ticketId)
  if (ticket.status === 'expired') throw err('二维码已过期', 410)
  if (ticket.status === 'pending') return { status: 'pending' }
  if (ticket.status === 'consumed') throw err('该登录已使用', 409)
  if (ticket.status !== 'confirmed') throw err('登录票状态异常', 409)

  await db().collection(TICKETS).doc(ticket.ticketId).update({
    data: { status: 'consumed', consumedAt: new Date() },
  })

  return {
    status: 'confirmed',
    role: ticket.role,
    displayName: ticket.displayName,
    openid: ticket.openid,
    username: `wx_${String(ticket.openid || '').slice(-6) || 'admin'}`,
  }
}

module.exports = {
  createAdminLoginTicket,
  getAdminLoginTicket,
  confirmAdminLogin,
  consumeAdminLoginTicket,
  findAdminByOpenid,
}
