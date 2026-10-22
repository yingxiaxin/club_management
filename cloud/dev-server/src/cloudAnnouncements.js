/**
 * 云库 announcements（管理端本机 API · P1 公告）
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const COLLECTION = 'announcements'

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

async function ensureCollection() {
  if (collectionsReady) return
  try {
    await getDb().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudAnnouncements] createCollection', msg)
    }
  }
  collectionsReady = true
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return {
    id: _id,
    title: String(rest.title || ''),
    content: String(rest.content || ''),
    pinned: Boolean(rest.pinned),
    publishedAt: rest.publishedAt || null,
    createdBy: rest.createdBy || null,
    createdAt: rest.createdAt || null,
    updatedAt: rest.updatedAt || null,
  }
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    const ta = new Date(a.publishedAt || a.createdAt || 0).getTime()
    const tb = new Date(b.publishedAt || b.createdAt || 0).getTime()
    return tb - ta
  })
}

export async function listAnnouncements() {
  await ensureCollection()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await getDb().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows.map(toClient).filter(Boolean))
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return sortRows(all)
}

export async function createAnnouncement(payload = {}, createdBy = 'admin') {
  await ensureCollection()
  const title = String(payload.title || '').trim()
  if (!title) throw err('公告标题不能为空', 400)
  const content = String(payload.content || '').trim()
  if (!content) throw err('公告正文不能为空', 400)
  const now = new Date().toISOString()
  const publishedAt = payload.publishedAt
    ? new Date(payload.publishedAt).toISOString()
    : now
  if (Number.isNaN(new Date(publishedAt).getTime())) {
    throw err('发布时间无效', 400)
  }
  const row = {
    title: title.slice(0, 80),
    content: content.slice(0, 4000),
    pinned: Boolean(payload.pinned),
    publishedAt,
    createdBy: String(createdBy || 'admin'),
    createdAt: now,
    updatedAt: now,
  }
  const res = await getDb().collection(COLLECTION).add(row)
  const id = res.id || res._id
  if (!id) throw err('创建失败', 500)
  return toClient({ _id: id, ...row })
}

export async function updateAnnouncement(id, payload = {}) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少公告 id', 400)

  let prev
  try {
    const res = await getDb().collection(COLLECTION).doc(docId).get()
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
    prev = rows[0]
  } catch {
    prev = null
  }
  if (!prev) throw err('公告不存在', 404)

  const patch = { updatedAt: new Date().toISOString() }
  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim()
    if (!title) throw err('公告标题不能为空', 400)
    patch.title = title.slice(0, 80)
  }
  if (payload.content !== undefined) {
    const content = String(payload.content || '').trim()
    if (!content) throw err('公告正文不能为空', 400)
    patch.content = content.slice(0, 4000)
  }
  if (payload.pinned !== undefined) {
    patch.pinned = Boolean(payload.pinned)
  }
  if (payload.publishedAt !== undefined) {
    const publishedAt = new Date(payload.publishedAt).toISOString()
    if (Number.isNaN(new Date(publishedAt).getTime())) {
      throw err('发布时间无效', 400)
    }
    patch.publishedAt = publishedAt
  }

  const upd = await getDb().collection(COLLECTION).doc(docId).update(patch)
  if (!upd || !upd.updated) {
    const next = { ...prev, ...patch }
    delete next._id
    await getDb().collection(COLLECTION).doc(docId).set(next)
  }

  const res = await getDb().collection(COLLECTION).doc(docId).get()
  const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
  return toClient(rows[0] ? { _id: docId, ...rows[0] } : { _id: docId, ...prev, ...patch })
}

export async function deleteAnnouncement(id) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少公告 id', 400)
  try {
    await getDb().collection(COLLECTION).doc(docId).remove()
  } catch (e) {
    throw err(e.message || '删除失败', 500)
  }
  return { id: docId, deleted: true }
}
