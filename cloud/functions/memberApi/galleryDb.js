/**
 * 踏云寻芳 gallery_posts（成员端）
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'gallery_posts'
const DEFAULT_QUOTA_BYTES = 2147483648
const MAX_CAPTION = 200
const MAX_BYTE_SIZE = 8 * 1024 * 1024
const MAX_POSTS_PER_AUTHOR = 50
const MAX_POSTS_PER_DAY = 10

function db() {
  return cloud.database()
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

let collectionReady = false

async function ensureCollection() {
  if (collectionReady) return
  try {
    await db().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[galleryDb] createCollection', msg)
    }
  }
  collectionReady = true
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return {
    id: _id,
    memberId: String(rest.memberId || ''),
    characterName: String(rest.characterName || ''),
    imageFileId: String(rest.imageFileId || ''),
    thumbFileId: rest.thumbFileId ? String(rest.thumbFileId) : null,
    byteSize: Number(rest.byteSize) || 0,
    caption: String(rest.caption || ''),
    status: rest.status || 'visible',
    createdAt: rest.createdAt || null,
    updatedAt: rest.updatedAt || null,
  }
}

async function fetchAllVisible() {
  await ensureCollection()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    for (const row of rows) {
      if (row && row.status === 'visible') all.push(toClient(row))
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  )
}

async function getQuotaBytes() {
  try {
    const clubDb = require('./clubDb')
    const club = await clubDb.getClubProfile()
    const n = Number(club.galleryStorageQuotaBytes)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  } catch {
    /* ignore */
  }
  return DEFAULT_QUOTA_BYTES
}

async function sumUsedBytes(list) {
  return (list || []).reduce((s, p) => s + (Number(p.byteSize) || 0), 0)
}

async function listGalleryPosts({ limit = 30 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 50)
  const all = await fetchAllVisible()
  return all.slice(0, lim)
}

async function getGalleryPost(id) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少帖子 id', 400)
  try {
    const res = await db().collection(COLLECTION).doc(docId).get()
    const row = res.data
    const client = toClient(row ? { _id: docId, ...row } : null)
    if (!client || client.status !== 'visible') throw err('内容不存在', 404)
    return client
  } catch (e) {
    if (e.status) throw e
    throw err('内容不存在', 404)
  }
}

function startOfShanghaiDayIso() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const day = fmt.format(new Date())
  return `${day}T00:00:00+08:00`
}

async function createGalleryPost(member, payload = {}) {
  await ensureCollection()
  if (!member?.id) throw err('请先绑定俱乐部角色后再发布', 403)

  const imageFileId = String(payload.imageFileId || '').trim()
  if (!imageFileId.startsWith('cloud://')) {
    throw err('请先上传图片', 400)
  }
  const thumbRaw = String(payload.thumbFileId || '').trim()
  const thumbFileId = thumbRaw.startsWith('cloud://') ? thumbRaw : null
  const byteSize = Math.floor(Number(payload.byteSize) || 0)
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw err('缺少图片大小', 400)
  }
  if (byteSize > MAX_BYTE_SIZE) {
    throw err('图片过大，请压缩后再传', 400)
  }
  const caption = String(payload.caption || '').trim().slice(0, MAX_CAPTION)

  const visible = await fetchAllVisible()
  const mine = visible.filter((p) => p.memberId === member.id)
  if (mine.length >= MAX_POSTS_PER_AUTHOR) {
    throw err(`每人最多保留 ${MAX_POSTS_PER_AUTHOR} 条，请先删除旧帖`, 409)
  }
  const dayStart = new Date(startOfShanghaiDayIso()).getTime()
  const todayCount = mine.filter(
    (p) => new Date(p.createdAt || 0).getTime() >= dayStart,
  ).length
  if (todayCount >= MAX_POSTS_PER_DAY) {
    throw err(`今日发帖已达上限（${MAX_POSTS_PER_DAY}）`, 429)
  }

  const used = await sumUsedBytes(visible)
  const quota = await getQuotaBytes()
  if (used + byteSize > quota) {
    throw err('俱乐部图库容量已满，请联系管理员', 409)
  }

  const now = new Date().toISOString()
  const row = {
    memberId: member.id,
    characterName: String(member.characterName || '').trim(),
    imageFileId,
    thumbFileId,
    byteSize,
    caption,
    status: 'visible',
    createdAt: now,
    updatedAt: now,
  }
  const res = await db().collection(COLLECTION).add({ data: row })
  const id = res._id || res.id
  if (!id) throw err('发布失败', 500)
  return toClient({ _id: id, ...row })
}

async function tryDeleteFiles(fileIds) {
  const list = [...new Set((fileIds || []).filter(Boolean))]
  if (!list.length) return
  try {
    await cloud.deleteFile({ fileList: list })
  } catch (e) {
    console.warn('[galleryDb] deleteFile', e?.message || e)
  }
}

/**
 * @param {{ id: string, actorMemberId?: string, isAdmin?: boolean }} opts
 */
async function deleteGalleryPost({ id, actorMemberId, isAdmin }) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少帖子 id', 400)

  let prev
  try {
    const res = await db().collection(COLLECTION).doc(docId).get()
    prev = res.data
  } catch {
    throw err('内容不存在', 404)
  }
  if (!prev || prev.status === 'deleted') throw err('内容不存在', 404)

  const authorOk = actorMemberId && prev.memberId === actorMemberId
  if (!isAdmin && !authorOk) throw err('无权删除', 403)

  const now = new Date().toISOString()
  await db().collection(COLLECTION).doc(docId).update({
    data: { status: 'deleted', updatedAt: now },
  })
  await tryDeleteFiles([prev.imageFileId, prev.thumbFileId])
  return { id: docId, deleted: true }
}

async function getGalleryStats() {
  const visible = await fetchAllVisible()
  const usedBytes = await sumUsedBytes(visible)
  const quotaBytes = await getQuotaBytes()
  return {
    postCount: visible.length,
    usedBytes,
    quotaBytes,
  }
}

module.exports = {
  listGalleryPosts,
  getGalleryPost,
  createGalleryPost,
  deleteGalleryPost,
  getGalleryStats,
  fetchAllVisible,
  DEFAULT_QUOTA_BYTES,
  MAX_CAPTION,
  ensureCollection,
}
