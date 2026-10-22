/**
 * P0-e 后端冒烟（不经过小程序）：
 * 建临时成员 → 建邀请码 → 写入待审申请 → 审核通过绑定 → 移出解绑
 *
 * 用法（须已启动本机 API，且 DATA_BACKEND=cloud）：
 *   node scripts/smoke-p0e.mjs
 */
import tcb from '@cloudbase/node-sdk'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { URL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SMOKE_API_BASE || 'http://127.0.0.1:3789'
const SMOKE_NAME = `冒烟P0e_${Date.now().toString(36)}`
const SMOKE_OPENID = `smoke_openid_${Date.now().toString(36)}`

function loadEnv() {
  const envFile = path.join(ROOT, '.env')
  if (!fs.existsSync(envFile)) return
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function api(method, urlPath, { token, body } = {}) {
  const u = new URL(urlPath, BASE)
  const payload = body !== undefined ? JSON.stringify(body) : null
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (payload) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(payload)
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = {}
          try {
            json = text ? JSON.parse(text) : {}
          } catch {
            reject(new Error(`${method} ${urlPath} → 非 JSON: ${text.slice(0, 200)}`))
            return
          }
          if (res.statusCode >= 400 || json.ok === false) {
            reject(
              new Error(
                `${method} ${urlPath} → ${res.statusCode} ${json.message || JSON.stringify(json)}`,
              ),
            )
            return
          }
          resolve(json.data !== undefined ? json.data : json)
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  loadEnv()
  console.log('[smoke-p0e] API', BASE)
  console.log('[smoke-p0e] characterName', SMOKE_NAME)
  console.log('[smoke-p0e] openid', SMOKE_OPENID)

  const health = await api('GET', '/api/health')
  assert(health.ok && health.membersBackend === 'cloud' && health.invites, 'health 须 cloud + invites')
  console.log('[ok] health', health.stage, health.membersBackend)

  const auth = await api('POST', '/api/auth/login', {
    body: { username: 'superadmin', password: 'club-change-me' },
  })
  const token = auth.token
  assert(token, 'login 未返回 token')
  console.log('[ok] login')

  const member = await api('POST', '/api/members', {
    token,
    body: {
      characterName: SMOKE_NAME,
      pathway: '冒烟',
      title: '测试',
      powerScore: 1,
      fashionScore: 1,
      level: 1,
      remark: 'P0-e 冒烟临时成员，可删',
    },
  })
  assert(member?.id, '创建成员失败')
  assert(!member.boundOpenid, '新成员不应已绑定')
  console.log('[ok] create member', member.id)

  const invite = await api('POST', '/api/invites', {
    token,
    body: { maxUses: 3 },
  })
  assert(invite?.code && invite?.id, '创建邀请码失败')
  console.log('[ok] create invite', invite.code)

  // 模拟小程序 submitJoinApplication（写入云库）
  assert(process.env.CLOUDBASE_ENV && process.env.CLOUDBASE_SECRET_ID && process.env.CLOUDBASE_SECRET_KEY, '缺 CLOUDBASE_*')
  const app = tcb.init({
    env: process.env.CLOUDBASE_ENV,
    secretId: process.env.CLOUDBASE_SECRET_ID,
    secretKey: process.env.CLOUDBASE_SECRET_KEY,
  })
  const db = app.database()
  const now = new Date().toISOString()
  const appDoc = {
    inviteCode: invite.code,
    inviteId: invite.id,
    openid: SMOKE_OPENID,
    characterName: SMOKE_NAME,
    memberId: member.id,
    pathway: member.pathway || '',
    remark: 'smoke-p0e',
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
  }
  const add = await db.collection('join_applications').add(appDoc)
  const appId = add.id || add._id
  assert(appId, '写入 join_applications 失败')
  console.log('[ok] seed join_application', appId)

  // 假用户行，便于验移出后清空 memberId
  await db.collection('users').add({
    openid: SMOKE_OPENID,
    role: 'guest',
    displayName: SMOKE_NAME,
    memberId: null,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  })
  console.log('[ok] seed users row')

  const reviewed = await api('POST', `/api/join-applications/${appId}/review`, {
    token,
    body: { decision: 'approved' },
  })
  assert(reviewed?.status === 'approved', '审核未通过')
  assert(reviewed?.memberId === member.id, '审核未挂上 memberId')
  console.log('[ok] approve')

  const bound = await api('GET', `/api/members/${member.id}`, { token })
  assert(bound.boundOpenid === SMOKE_OPENID, `绑定失败 boundOpenid=${bound.boundOpenid}`)
  console.log('[ok] member.boundOpenid 已绑定')

  const userRes = await db.collection('users').where({ openid: SMOKE_OPENID }).limit(1).get()
  const userRow = (userRes.data || [])[0]
  assert(userRow, '找不到 users 行')
  assert(userRow.memberId === member.id, `users.memberId 应为成员 id，实际=${userRow.memberId}`)
  console.log('[ok] users.memberId 已关联')

  const removed = await api('DELETE', `/api/members/${member.id}`, { token })
  assert(removed?.status === 'left', `移出后 status 应为 left，实际=${removed?.status}`)
  assert(!removed?.boundOpenid, `移出后 boundOpenid 应清空，实际=${removed?.boundOpenid}`)
  console.log('[ok] deleteMember → left + 清空 boundOpenid')

  const userAfter = await db.collection('users').where({ openid: SMOKE_OPENID }).limit(1).get()
  const u2 = (userAfter.data || [])[0]
  assert(u2 && (u2.memberId === null || u2.memberId === undefined || u2.memberId === ''), `移出后 users.memberId 应清空，实际=${u2?.memberId}`)
  assert(u2.role === 'guest', `移出后普通用户 role 应为 guest，实际=${u2.role}`)
  console.log('[ok] users.memberId 已清空且 role=guest')

  console.log('\n[smoke-p0e] PASS — 后端关联/审核/移出解绑链路正常')
  console.log('临时成员已 status=left，角色名:', SMOKE_NAME)
  console.log('小程序端仍需手测：邀请码+真实角色名提交 → 审核 → 能看列表')
}

main().catch((e) => {
  console.error('\n[smoke-p0e] FAIL', e.message || e)
  process.exit(1)
})
