/**
 * 本机通过 @cloudbase/node-sdk 读写微信云开发 members 集合。
 * 需环境变量：CLOUDBASE_ENV + CLOUDBASE_SECRET_ID + CLOUDBASE_SECRET_KEY
 */
import tcb from '@cloudbase/node-sdk'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memberMatchesPathways } from './pathwayFilter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COLLECTION = 'members'

let app = null

export function isCloudMembersConfigured() {
  return Boolean(
    process.env.CLOUDBASE_ENV &&
      process.env.CLOUDBASE_SECRET_ID &&
      process.env.CLOUDBASE_SECRET_KEY,
  )
}

function getDb() {
  if (!isCloudMembersConfigured()) {
    throw Object.assign(new Error('未配置云开发密钥（CLOUDBASE_ENV/SECRET_ID/SECRET_KEY）'), {
      status: 500,
    })
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

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function sortList(list, sort = 'powerScore', order = 'desc') {
  const dir = order === 'asc' ? 1 : -1
  const numericSorts = new Set(['level', 'powerScore', 'fashionScore'])
  return list.slice().sort((a, b) => {
    const av = a[sort]
    const bv = b[sort]
    if (numericSorts.has(sort) || (typeof av === 'number' && typeof bv === 'number')) {
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh') * dir
  })
}

async function fetchAll() {
  const database = getDb()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await database.collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

export async function listMembers({ sort = 'powerScore', order = 'desc', pathway, title, q } = {}) {
  let list = (await fetchAll()).map(toClient).filter((m) => m.status !== 'left')
  if (pathway) list = list.filter((m) => memberMatchesPathways(m.pathway, pathway))
  if (title) list = list.filter((m) => m.title === title)
  if (q) {
    const key = String(q).trim().toLowerCase()
    list = list.filter(
      (m) =>
        (m.characterName || '').toLowerCase().includes(key) ||
        (m.remark || '').toLowerCase().includes(key) ||
        (m.pathway || '').toLowerCase().includes(key),
    )
  }
  return sortList(list, sort, order)
}

export async function getMember(id) {
  try {
    const res = await getDb().collection(COLLECTION).doc(String(id)).get()
    const data = Array.isArray(res.data) ? res.data[0] : res.data
    return toClient(data)
  } catch {
    return null
  }
}

export async function findActiveByName(name) {
  const res = await getDb()
    .collection(COLLECTION)
    .where({ characterName: name, status: 'active' })
    .limit(1)
    .get()
  return toClient((res.data || [])[0])
}

/** 按角色名查找（含已退出），用于导入/OCR 恢复在职 */
async function findAnyByName(name) {
  const res = await getDb().collection(COLLECTION).where({ characterName: name }).limit(20).get()
  const rows = (res.data || []).map(toClient)
  const active = rows.find((m) => m.status === 'active')
  if (active) return active
  return rows[0] || null
}

function isDupNameError(e) {
  const msg = String(e?.message || e?.errMsg || '')
  return msg.includes('E11000') || /duplicate key/i.test(msg)
}

export async function createMember(payload) {
  const name = String(payload.characterName || '').trim()
  if (!name) throw err('角色名必填', 400)
  const existing = await findAnyByName(name)
  if (existing) {
    // 云库 characterName 唯一索引含已移出；手录同名时恢复在职（与 OCR 导入一致）
    if (existing.status === 'active') throw err('角色名已存在', 409)
    const restored = await updateMember(existing.id, {
      characterName: name,
      level: Number(payload.level) || 0,
      powerScore: Number(payload.powerScore) || 0,
      fashionScore: Number(payload.fashionScore) || 0,
      pathway: String(payload.pathway || '').trim() || '未填写',
      title: String(payload.title || '').trim() || '成员',
      remark: String(payload.remark || '').trim(),
      status: 'active',
    })
    return { ...restored, restoredFromLeft: true }
  }
  const now = new Date().toISOString()
  const id = payload.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const row = {
    characterName: name,
    level: Number(payload.level) || 0,
    powerScore: Number(payload.powerScore) || 0,
    fashionScore: Number(payload.fashionScore) || 0,
    pathway: String(payload.pathway || '').trim() || '未填写',
    title: String(payload.title || '').trim() || '成员',
    remark: String(payload.remark || '').trim(),
    status: 'active',
    joinedAt: payload.joinedAt || now,
    createdAt: payload.createdAt || now,
    updatedAt: now,
    boundOpenid: payload.boundOpenid || null,
    lastOcrJobId: payload.lastOcrJobId || null,
  }
  try {
    await getDb().collection(COLLECTION).doc(id).set(row)
  } catch (e) {
    if (isDupNameError(e)) throw err('角色名已存在', 409)
    throw e
  }
  return { id, ...row }
}

export async function updateMember(id, payload) {
  const current = await getMember(id)
  if (!current) throw err('成员不存在', 404)
  const body = payload || {}
  const patch = {}
  if (body.characterName !== undefined) {
    const name = String(body.characterName ?? '').trim()
    if (!name) throw err('角色名必填', 400)
    // 唯一索引含已移出；改名不可撞上任意同名文档
    const other = await findAnyByName(name)
    if (other && other.id !== id) throw err('角色名已存在', 409)
    patch.characterName = name
  }
  for (const key of ['level', 'powerScore', 'fashionScore']) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      patch[key] = Number(body[key]) || 0
    } else if (body[key] === null || body[key] === '') {
      patch[key] = 0
    }
  }
  for (const key of ['pathway', 'title', 'remark', 'status']) {
    if (body[key] !== undefined) {
      patch[key] = typeof body[key] === 'string' ? String(body[key]).trim() : body[key]
    }
  }
  if (body.boundOpenid !== undefined) {
    patch.boundOpenid = body.boundOpenid || null
  }
  patch.updatedAt = new Date().toISOString()
  await getDb().collection(COLLECTION).doc(String(id)).update(patch)
  return { ...current, ...patch }
}

/**
 * 移出成员：status=left，并解除微信关联（boundOpenid + users.memberId）
 */
export async function deleteMember(id) {
  const current = await getMember(id)
  if (!current) throw err('成员不存在', 404)
  const openid = current.boundOpenid || null
  const updated = await updateMember(id, { status: 'left', boundOpenid: null })
  await clearUsersLinkedToMember(String(id), openid)
  await rejectPendingAppsForMember(String(id))
  return updated
}

async function clearUsersLinkedToMember(memberId, openid) {
  const col = getDb().collection('users')
  const rowsById = new Map()
  const remember = (rows) => {
    for (const row of rows || []) {
      if (row?._id) rowsById.set(row._id, row)
    }
  }
  try {
    const byMember = await col.where({ memberId }).limit(20).get()
    remember(byMember.data)
  } catch {
    /* ignore */
  }
  if (openid) {
    try {
      let res = await col.where({ openid }).limit(5).get()
      remember(res.data)
      res = await col.where({ _openid: openid }).limit(5).get()
      remember(res.data)
    } catch {
      /* ignore */
    }
  }
  for (const [uid, row] of rowsById) {
    try {
      const patch = { memberId: null, lastLoginAt: new Date() }
      // 普通成员降为 guest；不降级 admin / super_admin
      if (row.role === 'member') patch.role = 'guest'
      await col.doc(uid).update(patch)
    } catch (e) {
      console.warn('[cloudMembers] clear user memberId', uid, e?.message || e)
    }
  }
}

async function rejectPendingAppsForMember(memberId) {
  try {
    const col = getDb().collection('join_applications')
    const res = await col.where({ memberId, status: 'pending' }).limit(50).get()
    const now = new Date().toISOString()
    for (const row of res.data || []) {
      await col.doc(row._id).update({
        status: 'rejected',
        reviewedBy: 'system',
        reviewedAt: now,
        rejectReason: '成员已移出，关联申请自动关闭',
      })
    }
  } catch (e) {
    console.warn('[cloudMembers] reject pending apps', e?.message || e)
  }
}

export async function batchUpdateScores(items) {
  const updated = []
  for (const item of items || []) {
    if (!item?.id) continue
    const patch = {}
    if (item.powerScore != null) patch.powerScore = Number(item.powerScore) || 0
    if (item.fashionScore != null) patch.fashionScore = Number(item.fashionScore) || 0
    if (!Object.keys(patch).length) continue
    updated.push(await updateMember(item.id, patch))
  }
  return updated
}

export async function upsertMembersByName(rows, { ocrJobId } = {}) {
  const created = []
  const updated = []
  const skipped = []
  const now = new Date().toISOString()
  for (const item of rows || []) {
    if (item.selected === false) {
      skipped.push({ characterName: item.characterName, reason: '未勾选' })
      continue
    }
    const name = String(item.characterName || '').trim()
    if (!name) {
      skipped.push({ characterName: '', reason: '角色名为空' })
      continue
    }
    const patch = {
      characterName: name,
      level: Number(item.level) || 0,
      powerScore: Number(item.powerScore) || 0,
      fashionScore: Number(item.fashionScore) || 0,
      pathway: String(item.pathway || '').trim() || '未填写',
      title: String(item.title || '').trim() || '成员',
      status: 'active',
    }
    if (ocrJobId) patch.lastOcrJobId = ocrJobId
    const existing = await findAnyByName(name)
    if (existing) updated.push(await updateMember(existing.id, patch))
    else {
      created.push(
        await createMember({
          ...patch,
          remark: String(item.remark || '').trim(),
          joinedAt: now,
          createdAt: now,
        }),
      )
    }
  }
  return { created, updated, skipped }
}

export async function annotateCandidates(candidates) {
  const all = (await fetchAll()).map(toClient)
  return (candidates || []).map((c, index) => {
    const name = String(c.characterName || '').trim()
    const matched = name ? all.find((m) => m.characterName === name) : null
    return {
      localId: `c-${index + 1}`,
      characterName: name,
      title: String(c.title || '').trim() || '成员',
      pathway: String(c.pathway || '').trim() || '未填写',
      level: Number(c.level) || 0,
      powerScore: Number(c.powerScore) || 0,
      fashionScore: Number(c.fashionScore) || 0,
      confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
      lowConfidence: Boolean(c.lowConfidence) || name.length < 2,
      issues: c.issues || [],
      action: matched ? 'update' : 'create',
      matchedMemberId: matched?.id || null,
      matchedWasLeft: matched?.status === 'left',
      selected: Boolean(name),
    }
  })
}

/** 将本地 members.json 写入云库（按 id upsert） */
export async function importFromLocalFile(filePath) {
  const abs = path.resolve(filePath)
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'))
  if (!Array.isArray(rows)) throw err('导入文件须为数组', 400)
  const imported = []
  const skipped = []
  for (const raw of rows) {
    const name = String(raw.characterName || '').trim()
    if (!name) {
      skipped.push({ reason: '空名' })
      continue
    }
    const id = String(raw.id || raw._id || '').trim()
    const doc = {
      characterName: name,
      level: Number(raw.level) || 0,
      powerScore: Number(raw.powerScore) || 0,
      fashionScore: Number(raw.fashionScore) || 0,
      pathway: String(raw.pathway || '').trim() || '未填写',
      title: String(raw.title || '').trim() || '成员',
      remark: String(raw.remark || '').trim(),
      // 批量导入一律视为在职；仅管理端手动移出才标 left
      status: 'active',
      joinedAt: raw.joinedAt || null,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
      boundOpenid: raw.boundOpenid || null,
      lastOcrJobId: raw.lastOcrJobId || null,
    }
    if (!id) {
      imported.push(await createMember(doc))
      continue
    }
    await getDb().collection(COLLECTION).doc(id).set(doc)
    imported.push({ id, ...doc })
  }
  return { imported: imported.length, skipped, total: rows.length }
}

export function loadEnvDefaultsFromRepo() {
  try {
    const envFile = path.resolve(__dirname, '../../env.json')
    if (!fs.existsSync(envFile)) return
    const conf = JSON.parse(fs.readFileSync(envFile, 'utf8'))
    if (!process.env.CLOUDBASE_ENV && conf.envId) process.env.CLOUDBASE_ENV = conf.envId
  } catch {
    /* ignore */
  }
}
