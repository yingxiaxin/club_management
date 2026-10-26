/**
 * 踏云寻芳 gallery_posts（成员端）
 * 同一次发布的多图共用 albumId，列表/详情按作品（相册）聚合。
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'gallery_posts'
const LIKES_COLLECTION = 'gallery_likes'
const MEMBERS = 'members'
const DEFAULT_QUOTA_BYTES = 2147483648
const MAX_CAPTION = 200
const MAX_BYTE_SIZE = 8 * 1024 * 1024
const MAX_POSTS_PER_AUTHOR = 50
const MAX_POSTS_PER_DAY = 10
const MAX_ALBUM_ID = 64

function db() {
  return cloud.database()
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

let collectionReady = false
let likesReady = false

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

async function ensureLikesCollection() {
  if (likesReady) return
  try {
    await db().createCollection(LIKES_COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[galleryDb] createLikesCollection', msg)
    }
  }
  likesReady = true
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
    /** 仅库内真实字段；缺省为 ''，聚合时走旧帖启发式 */
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

function normalizeAlbumId(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s.length > MAX_ALBUM_ID) throw err('albumId 过长', 400)
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw err('albumId 格式无效', 400)
  return s
}

function toImageBrief(p) {
  return {
    id: p.id,
    imageFileId: p.imageFileId,
    thumbFileId: p.thumbFileId,
    byteSize: p.byteSize,
    createdAt: p.createdAt,
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
    pathway: '',
    caption: cover.caption,
    createdAt: cover.createdAt,
    updatedAt: latest.updatedAt || latest.createdAt,
    imageCount: sorted.length,
    byteSize: sorted.reduce((s, i) => s + (Number(i.byteSize) || 0), 0),
    imageFileId: cover.imageFileId,
    thumbFileId: cover.thumbFileId,
    images: sorted.map(toImageBrief),
  }
}

/** 作者途径：供小程序角色名上色 */
async function attachAuthorPathway(albums) {
  const list = Array.isArray(albums) ? albums : []
  if (!list.length) return list
  const ids = [...new Set(list.map((a) => String(a.memberId || '')).filter(Boolean))]
  const pathMap = new Map()
  for (const id of ids) {
    try {
      const res = await db().collection(MEMBERS).doc(id).get()
      const row = Array.isArray(res.data) ? res.data[0] : res.data
      pathMap.set(id, (row && row.pathway) || '')
    } catch {
      pathMap.set(id, '')
    }
  }
  return list.map((a) => ({
    ...a,
    pathway: pathMap.get(String(a.memberId || '')) || a.pathway || '',
  }))
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
    const aid = cluster[0].id
    albums.push(buildAlbum(aid, cluster))
  }
  return albums.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  )
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

async function fetchAllLikes() {
  await ensureLikesCollection()
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db().collection(LIKES_COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    for (const row of rows) {
      if (!row) continue
      all.push({
        id: row._id,
        albumId: String(row.albumId || '').trim(),
        memberId: String(row.memberId || '').trim(),
        createdAt: row.createdAt || null,
      })
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

function buildLikeMaps(likes) {
  const countByAlbum = new Map()
  const membersByAlbum = new Map()
  for (const like of likes || []) {
    if (!like.albumId) continue
    countByAlbum.set(like.albumId, (countByAlbum.get(like.albumId) || 0) + 1)
    if (!membersByAlbum.has(like.albumId)) membersByAlbum.set(like.albumId, new Set())
    if (like.memberId) membersByAlbum.get(like.albumId).add(like.memberId)
  }
  return { countByAlbum, membersByAlbum }
}

function attachLikes(albums, likes, viewerMemberId) {
  const { countByAlbum, membersByAlbum } = buildLikeMaps(likes)
  const mid = String(viewerMemberId || '').trim()
  return (albums || []).map((a) => {
    const aid = a.albumId || a.id
    const set = membersByAlbum.get(aid)
    return {
      ...a,
      likeCount: countByAlbum.get(aid) || 0,
      likedByMe: Boolean(mid && set && set.has(mid)),
    }
  })
}

function sortAlbums(albums, sort) {
  const mode = String(sort || 'likes').trim() === 'newest' ? 'newest' : 'likes'
  const list = albums.slice()
  if (mode === 'newest') {
    list.sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )
  } else {
    list.sort((a, b) => {
      const lc = (b.likeCount || 0) - (a.likeCount || 0)
      if (lc !== 0) return lc
      return (
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      )
    })
  }
  return list
}

/** 列表按作品（album）聚合；sort: likes|newest */
async function listGalleryPosts({ limit = 30, sort = 'likes', viewerMemberId } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 50)
  const [all, likes] = await Promise.all([fetchAllVisible(), fetchAllLikes()])
  const albums = attachLikes(groupIntoAlbums(all), likes, viewerMemberId)
  const sorted = sortAlbums(albums, sort).slice(0, lim)
  return attachAuthorPathway(sorted)
}

async function findAlbumByRef(refId) {
  const key = String(refId || '').trim()
  if (!key) throw err('缺少作品 id', 400)
  const all = await fetchAllVisible()
  const albums = groupIntoAlbums(all)
  const byAlbum = albums.find((a) => a.albumId === key || a.id === key)
  if (byAlbum) return byAlbum
  const byImage = albums.find((a) => (a.images || []).some((i) => i.id === key))
  if (byImage) return byImage
  throw err('内容不存在', 404)
}

/** id 可为 albumId 或单图 post id */
async function getGalleryPost(id, { viewerMemberId } = {}) {
  const album = await findAlbumByRef(id)
  const likes = await fetchAllLikes()
  const [enriched] = await attachAuthorPathway(
    attachLikes([album], likes, viewerMemberId),
  )
  return enriched
}

/**
 * 点赞 / 取消点赞（作品级）
 * @param {{ albumId: string, member: { id: string } }} opts
 */
async function toggleGalleryLike({ albumId, member }) {
  if (!member?.id) throw err('请先绑定俱乐部角色后再点赞', 403)
  const album = await findAlbumByRef(albumId)
  const aid = album.albumId
  await ensureLikesCollection()
  const mid = member.id
  const res = await db()
    .collection(LIKES_COLLECTION)
    .where({ albumId: aid, memberId: mid })
    .limit(5)
    .get()
  const rows = res.data || []
  if (rows.length) {
    for (const row of rows) {
      if (row._id) await db().collection(LIKES_COLLECTION).doc(row._id).remove()
    }
  } else {
    await db().collection(LIKES_COLLECTION).add({
      data: {
        albumId: aid,
        memberId: mid,
        createdAt: new Date().toISOString(),
      },
    })
  }
  const likes = await fetchAllLikes()
  const enriched = attachLikes([album], likes, mid)[0]
  return {
    albumId: aid,
    liked: enriched.likedByMe,
    likeCount: enriched.likeCount,
  }
}

async function deleteLikesForAlbum(albumId) {
  const aid = String(albumId || '').trim()
  if (!aid) return
  await ensureLikesCollection()
  try {
    const res = await db().collection(LIKES_COLLECTION).where({ albumId: aid }).limit(100).get()
    for (const row of res.data || []) {
      if (row._id) await db().collection(LIKES_COLLECTION).doc(row._id).remove()
    }
  } catch (e) {
    console.warn('[galleryDb] deleteLikesForAlbum', e?.message || e)
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
  const albumId = normalizeAlbumId(payload.albumId)

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
  if (albumId) row.albumId = albumId

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
 * 删除单张图片（帖子）
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

/**
 * 撤回整部作品（同 album 下全部可见图）
 */
async function deleteGalleryAlbum({ albumId, actorMemberId, isAdmin }) {
  const album = await findAlbumByRef(albumId)
  const authorOk = actorMemberId && album.memberId === actorMemberId
  if (!isAdmin && !authorOk) throw err('无权删除', 403)

  const results = []
  for (const img of album.images) {
    results.push(
      await deleteGalleryPost({
        id: img.id,
        actorMemberId,
        isAdmin: true,
      }),
    )
  }
  await deleteLikesForAlbum(album.albumId)
  return { albumId: album.albumId, deleted: true, images: results.length }
}

async function getGalleryStats() {
  const visible = await fetchAllVisible()
  const usedBytes = await sumUsedBytes(visible)
  const quotaBytes = await getQuotaBytes()
  return {
    postCount: visible.length,
    albumCount: groupIntoAlbums(visible).length,
    usedBytes,
    quotaBytes,
  }
}

module.exports = {
  listGalleryPosts,
  getGalleryPost,
  createGalleryPost,
  deleteGalleryPost,
  deleteGalleryAlbum,
  toggleGalleryLike,
  getGalleryStats,
  fetchAllVisible,
  groupIntoAlbums,
  DEFAULT_QUOTA_BYTES,
  MAX_CAPTION,
  ensureCollection,
}
