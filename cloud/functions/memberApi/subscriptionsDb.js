/**
 * 活动提醒订阅记录（成员点「提醒我」授权后写入）
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'subscriptions'

let collectionsReady = false

function db() {
  return cloud.database()
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

function docId(activityId, openid) {
  return `${String(activityId)}__${String(openid)}`
}

async function ensureCollection() {
  if (collectionsReady) return
  try {
    await db().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[subscriptionsDb] createCollection', msg)
    }
  }
  collectionsReady = true
}

async function getMine(activityId, openid) {
  if (!activityId || !openid) return null
  await ensureCollection()
  try {
    const res = await db().collection(COLLECTION).doc(docId(activityId, openid)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function upsertActive({ activityId, openid, memberId }) {
  await ensureCollection()
  const aid = String(activityId || '').trim()
  const oid = String(openid || '').trim()
  if (!aid) throw err('缺少活动 id', 400)
  if (!oid) throw err('缺少微信身份', 401)

  const now = new Date().toISOString()
  const id = docId(aid, oid)
  const row = {
    activityId: aid,
    openid: oid,
    memberId: memberId ? String(memberId) : null,
    status: 'active',
    updatedAt: now,
  }
  const existing = await getMine(aid, oid)
  if (existing) {
    await db().collection(COLLECTION).doc(id).update({
      data: {
        status: 'active',
        memberId: row.memberId,
        updatedAt: now,
      },
    })
  } else {
    await db()
      .collection(COLLECTION)
      .doc(id)
      .set({ data: { ...row, createdAt: now } })
  }
  return { id, ...row, createdAt: existing?.createdAt || now }
}

async function listActiveByActivity(activityId) {
  await ensureCollection()
  const id = String(activityId)
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db()
      .collection(COLLECTION)
      .where({ activityId: id, status: 'active' })
      .skip(offset)
      .limit(pageSize)
      .get()
    const rows = (res.data || []).map(toClient)
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

module.exports = {
  getMine,
  upsertActive,
  listActiveByActivity,
  ensureCollection,
}
