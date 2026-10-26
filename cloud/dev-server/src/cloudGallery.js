/**
 * 云库 gallery_posts（管理端本机 API · 踏云寻芳）
 * 列表按作品（album）聚合；单图删除 / 整部撤回。
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'
import * as cloudClub from './cloudClub.js'

const COLLECTION = 'gallery_posts'
const LIKES_COLLECTION = 'gallery_likes'
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

/** 无 albumId 的旧多图：同作者+同题目且创建时间接近则合成一部 */
const LEGACY_ALBUM_WINDOW_MS = 3 * 60 * 1000

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  const id = _id || rest.id
  const albumRaw = String(rest.albumId || '').trim()
  return {
    id,
    albumId: albumRaw,
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

function buildAlbum(aid, images) {
  const sorted = images.slice().sort(
    (a, b) =>
      new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  )
  const cover = sorted[0]
  const latest = sorted[sorted.length - 1]
  return {
    id: aid,
    albumId: aid,
    memberId: cover.memberId,
    characterName: cover.characterName,
    caption: cover.caption,
    createdAt: cover.createdAt,
    updatedAt: latest.updatedAt || latest.createdAt,
    imageCount: sorted.length,
    byteSize: sorted.reduce((s, i) => s + (Number(i.byteSize) || 0), 0),
    imageFileId: cover.imageFileId,
    thumbFileId: cover.thumbFileId,
    images: sorted.map((p) => ({
      id: p.id,
      imageFileId: p.imageFileId,
      thumbFileId: p.thumbFileId,
      byteSize: p.byteSize,
      createdAt: p.createdAt,
    })),
  }
}

function clusterLegacyPosts(loose) {
  const sorted = loose.slice().sort(
    (a, b) =>
      new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  )
  const clusters = []
  for (const p of sorted) {
    let placed = false
    for (const cluster of clusters) {
      const anchor = cluster[0]
      const last = cluster[cluster.length - 1]
      const t = new Date(p.createdAt || 0).getTime()
      const t0 = new Date(anchor.createdAt || 0).getTime()
      const t1 = new Date(last.createdAt || 0).getTime()
      if (
        p.memberId === anchor.memberId &&
        String(p.caption || '') === String(anchor.caption || '') &&
        Number.isFinite(t) &&
        Math.abs(t - t0) <= LEGACY_ALBUM_WINDOW_MS &&
        Math.abs(t - t1) <= LEGACY_ALBUM_WINDOW_MS
      ) {
        cluster.push(p)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([p])
  }
  return clusters
}

function groupIntoAlbums(posts) {
  const explicit = new Map()
  const loose = []
  for (const p of posts || []) {
    const raw = String(p.albumId || '').trim()
    if (raw) {
      if (!explicit.has(raw)) explicit.set(raw, [])
      explicit.get(raw).push(p)
    } else {
      loose.push(p)
    }
  }
  const albums = []
  for (const [aid, images] of explicit) {
    albums.push(buildAlbum(aid, images))
  }
  for (const cluster of clusterLegacyPosts(loose)) {
    albums.push(buildAlbum(cluster[0].id, cluster))
  }
  return albums.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  )
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

function enrichAlbum(album, urlMap) {
  const images = (album.images || []).map((img) => ({
    ...img,
    thumbUrl: urlMap[img.thumbFileId] || urlMap[img.imageFileId] || '',
    imageUrl: urlMap[img.imageFileId] || '',
  }))
  const cover = images[0]
  return {
    ...album,
    images,
    thumbUrl: cover?.thumbUrl || cover?.imageUrl || '',
    imageUrl: cover?.imageUrl || '',
  }
}

async function fetchLikeCounts() {
  const pageSize = 100
  let offset = 0
  const countByAlbum = new Map()
  try {
    for (;;) {
      const res = await getDb().collection(LIKES_COLLECTION).skip(offset).limit(pageSize).get()
      const rows = res.data || []
      for (const row of rows) {
        const aid = String(row?.albumId || '').trim()
        if (!aid) continue
        countByAlbum.set(aid, (countByAlbum.get(aid) || 0) + 1)
      }
      if (rows.length < pageSize) break
      offset += pageSize
    }
  } catch (e) {
    console.warn('[cloudGallery] fetchLikeCounts', e?.message || e)
  }
  return countByAlbum
}

export async function listGalleryWithStats() {
  const posts = await fetchVisible()
  const albums = groupIntoAlbums(posts)
  const usedBytes = posts.reduce((s, p) => s + (Number(p.byteSize) || 0), 0)
  const [quotaBytes, urlMap, likeCounts] = await Promise.all([
    getQuotaBytes(),
    resolveTempUrls(posts.flatMap((p) => [p.thumbFileId || p.imageFileId, p.imageFileId])),
    fetchLikeCounts(),
  ])
  const enriched = albums
    .map((a) => ({
      ...enrichAlbum(a, urlMap),
      likeCount: likeCounts.get(a.albumId) || 0,
    }))
    .sort((a, b) => {
      const lc = (b.likeCount || 0) - (a.likeCount || 0)
      if (lc !== 0) return lc
      return (
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      )
    })
  return {
    list: enriched,
    stats: {
      postCount: posts.length,
      albumCount: albums.length,
      usedBytes,
      quotaBytes,
    },
  }
}

export async function getGalleryAlbum(refId) {
  const key = String(refId || '').trim()
  if (!key) throw err('缺少作品 id', 400)
  const posts = await fetchVisible()
  const albums = groupIntoAlbums(posts)
  let album = albums.find((a) => a.albumId === key || a.id === key)
  if (!album) {
    album = albums.find((a) => (a.images || []).some((i) => i.id === key))
  }
  if (!album) throw err('内容不存在', 404)
  const urlMap = await resolveTempUrls(
    album.images.flatMap((p) => [p.thumbFileId, p.imageFileId]),
  )
  return enrichAlbum(album, urlMap)
}

/** @deprecated 兼容旧路由：按帖或 album 取作品详情 */
export async function getGalleryPost(id) {
  return getGalleryAlbum(id)
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

export async function deleteGalleryAlbum(refId) {
  const album = await getGalleryAlbum(refId)
  const results = []
  for (const img of album.images) {
    results.push(await deleteGalleryPost(img.id))
  }
  return { albumId: album.albumId, deleted: true, images: results.length }
}

export { DEFAULT_QUOTA_BYTES }
