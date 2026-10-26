/**
 * 云库 gallery_posts（管理端本机 API · 踏云寻芳）
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'
import * as cloudClub from './cloudClub.js'

const COLLECTION = 'gallery_posts'
const DEFAULT_QUOTA_BYTES = 2147483648

let app = null
let collectionsReady = false

function getApp() {
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
  return app
}

function getDb() {
  return getApp().database()
}

async function ensureCollection() {
  if (collectionsReady) return
  try {
    await getDb().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudGallery] createCollection', msg)
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

async function resolveTempUrls(fileIds) {
  const list = [...new Set((fileIds || []).filter((id) => String(id || '').startsWith('cloud://')))]
  const map = {}
  if (!list.length) return map
  try {
    const res = await getApp().getTempFileURL({ fileList: list })
    for (const item of res.fileList || []) {
      const fid = item.fileID || item.fileId
      const url = item.tempFileURL || item.download_url
      if (fid && url) map[fid] = String(url)
    }
  } catch (e) {
    console.warn('[cloudGallery] getTempFileURL', e?.message || e)
  }
  return map
}

async function fetchVisible() {
  await ensureCollection()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await getDb().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    for (const row of rows) {
      const c = toClient(row)
      if (c && c.status === 'visible') all.push(c)
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
    const club = await cloudClub.getClubProfile()
    const n = Number(club.galleryStorageQuotaBytes)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  } catch {
    /* ignore */
  }
  return DEFAULT_QUOTA_BYTES
}

export async function listGalleryWithStats() {
  const list = await fetchVisible()
  const usedBytes = list.reduce((s, p) => s + (Number(p.byteSize) || 0), 0)
  const quotaBytes = await getQuotaBytes()
  const urlMap = await resolveTempUrls(
    list.flatMap((p) => [p.thumbFileId || p.imageFileId, p.imageFileId]),
  )
  const enriched = list.map((p) => ({
    ...p,
    thumbUrl: urlMap[p.thumbFileId] || urlMap[p.imageFileId] || '',
    imageUrl: urlMap[p.imageFileId] || '',
  }))
  return {
    list: enriched,
    stats: {
      postCount: list.length,
      usedBytes,
      quotaBytes,
    },
  }
}

export async function getGalleryPost(id) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少帖子 id', 400)
  let prev
  try {
    const res = await getDb().collection(COLLECTION).doc(docId).get()
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
    prev = rows[0]
  } catch {
    throw err('内容不存在', 404)
  }
  const client = toClient(prev ? { _id: docId, ...prev } : null)
  if (!client || client.status !== 'visible') throw err('内容不存在', 404)
  const urlMap = await resolveTempUrls([client.thumbFileId, client.imageFileId])
  return {
    ...client,
    thumbUrl: urlMap[client.thumbFileId] || urlMap[client.imageFileId] || '',
    imageUrl: urlMap[client.imageFileId] || '',
  }
}

export async function deleteGalleryPost(id) {
  await ensureCollection()
  const docId = String(id || '').trim()
  if (!docId) throw err('缺少帖子 id', 400)
  let prev
  try {
    const res = await getDb().collection(COLLECTION).doc(docId).get()
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
    prev = rows[0]
  } catch {
    throw err('内容不存在', 404)
  }
  if (!prev || prev.status === 'deleted') throw err('内容不存在', 404)

  const now = new Date().toISOString()
  await getDb().collection(COLLECTION).doc(docId).update({
    status: 'deleted',
    updatedAt: now,
  })

  const fileList = [prev.imageFileId, prev.thumbFileId].filter((f) =>
    String(f || '').startsWith('cloud://'),
  )
  if (fileList.length) {
    try {
      await getApp().deleteFile({ fileList })
    } catch (e) {
      console.warn('[cloudGallery] deleteFile', e?.message || e)
    }
  }
  return { id: docId, deleted: true }
}

export { DEFAULT_QUOTA_BYTES }
