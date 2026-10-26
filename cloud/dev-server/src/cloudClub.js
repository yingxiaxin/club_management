/**
 * 云库 club_profile（单文档 club_main）—— 默认提醒与订阅模板
 *
 * 注意：CloudBase node-sdk 对不存在的文档调用 update 会返回 { updated: 0 } 且不抛错，
 * 必须先判断文档是否存在，不存在时用 set 创建。
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'

const COLLECTION = 'club_profile'
const DOC_ID = 'club_main'
const ALLOWED_OFFSETS = new Set([5, 10, 15, 30, 60, 120])

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

const ICON_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 管理端预览：cloud:// 换临时 HTTPS；普通 URL 原样返回 */
export async function resolveIconDisplayUrl(iconUrl) {
  const raw = String(iconUrl || '').trim()
  if (!raw) return ''
  if (!raw.startsWith('cloud://')) return raw
  try {
    const res = await getApp().getTempFileURL({ fileList: [raw] })
    const item = (res.fileList || [])[0]
    if (item && (item.tempFileURL || item.download_url)) {
      return String(item.tempFileURL || item.download_url)
    }
  } catch (e) {
    console.warn('[cloudClub] getTempFileURL', e?.message || e)
  }
  return raw
}

async function withDisplayUrl(profile) {
  const iconDisplayUrl = await resolveIconDisplayUrl(profile.iconUrl)
  return { ...profile, iconDisplayUrl }
}

/**
 * 上传俱乐部图标到云存储，返回 fileID（写入 club_profile.iconUrl）
 * @param {{ buffer: Buffer, mimetype?: string, originalname?: string }} file
 */
export async function uploadClubIcon(file, updatedBy = 'admin') {
  if (!file?.buffer?.length) throw err('请选择图片文件', 400)
  if (file.buffer.length > 10 * 1024 * 1024) throw err('图标不能超过 10MB', 400)
  const mime = String(file.mimetype || '').toLowerCase()
  const ext =
    ICON_MIME_EXT[mime] ||
    String(file.originalname || '')
      .split('.')
      .pop()
      ?.toLowerCase()
  if (!ext || !['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext === 'jpeg' ? 'jpg' : ext)) {
    throw err('仅支持 PNG / JPG / WebP / GIF', 400)
  }
  const safeExt = ext === 'jpeg' ? 'jpg' : ext
  const cloudPath = `club/icon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
  const up = await getApp().uploadFile({
    cloudPath,
    fileContent: file.buffer,
  })
  const fileID = String(up.fileID || up.fileId || '').trim()
  if (!fileID) throw err('上传失败：未返回 fileID', 500)
  const saved = await updateClubProfile({ iconUrl: fileID }, updatedBy)
  return withDisplayUrl(saved)
}

async function ensureCollection() {
  if (collectionsReady) return
  try {
    await getDb().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[cloudClub] createCollection', msg)
    }
  }
  collectionsReady = true
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function normalizeOffsets(raw, fallback = [10]) {
  if (raw === null || raw === undefined) return fallback.slice()
  if (!Array.isArray(raw)) return fallback.slice()
  const nums = [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => ALLOWED_OFFSETS.has(n))
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b)
  return nums.length ? nums : fallback.slice()
}

function defaults() {
  return {
    id: DOC_ID,
    name: '诡秘之主俱乐部',
    iconUrl: '',
    intro: '',
    reminderOffsetsMinutes: [10],
    subscribeTemplateId: '',
    subscribeMiniprogramState: 'developer',
    galleryStorageQuotaBytes: null,
    updatedAt: null,
    updatedBy: null,
  }
}

function toClient(doc) {
  if (!doc) return defaults()
  const { _id, _openid, ...rest } = doc
  const quota = Number(rest.galleryStorageQuotaBytes)
  return {
    ...defaults(),
    ...rest,
    id: _id || DOC_ID,
    reminderOffsetsMinutes: normalizeOffsets(rest.reminderOffsetsMinutes, [10]),
    subscribeTemplateId: String(rest.subscribeTemplateId || '').trim(),
    subscribeMiniprogramState: ['developer', 'trial', 'formal'].includes(
      rest.subscribeMiniprogramState,
    )
      ? rest.subscribeMiniprogramState
      : 'developer',
    galleryStorageQuotaBytes:
      Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : null,
  }
}

/** 原始文档；不存在返回 null（勿与 defaults 混淆） */
async function getRawDoc() {
  await ensureCollection()
  try {
    const res = await getDb().collection(COLLECTION).doc(DOC_ID).get()
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
    return rows[0] || null
  } catch {
    return null
  }
}

export async function getClubProfile() {
  const row = await getRawDoc()
  return withDisplayUrl(toClient(row))
}

export async function updateClubProfile(payload = {}, updatedBy = 'admin') {
  await ensureCollection()
  const currentRaw = await getRawDoc()
  const current = toClient(currentRaw)
  const patch = {
    updatedAt: new Date().toISOString(),
    updatedBy: String(updatedBy || 'admin'),
  }

  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim()
    if (!name) throw err('俱乐部名称不能为空', 400)
    patch.name = name.slice(0, 64)
  }
  if (payload.iconUrl !== undefined) {
    patch.iconUrl = String(payload.iconUrl || '').trim()
  }
  if (payload.intro !== undefined) {
    patch.intro = String(payload.intro || '').trim().slice(0, 500)
  }
  if (payload.reminderOffsetsMinutes !== undefined) {
    patch.reminderOffsetsMinutes = normalizeOffsets(payload.reminderOffsetsMinutes, [10])
  }
  if (payload.subscribeTemplateId !== undefined) {
    patch.subscribeTemplateId = String(payload.subscribeTemplateId || '').trim()
  }
  if (payload.subscribeMiniprogramState !== undefined) {
    const s = String(payload.subscribeMiniprogramState || '').trim()
    if (!['developer', 'trial', 'formal'].includes(s)) {
      throw err('小程序状态须为 developer/trial/formal', 400)
    }
    patch.subscribeMiniprogramState = s
  }
  if (payload.galleryStorageQuotaBytes !== undefined) {
    if (payload.galleryStorageQuotaBytes === null || payload.galleryStorageQuotaBytes === '') {
      patch.galleryStorageQuotaBytes = null
    } else {
      const n = Math.floor(Number(payload.galleryStorageQuotaBytes))
      if (!Number.isFinite(n) || n < 1024 * 1024) {
        throw err('容量上限至少 1MB', 400)
      }
      patch.galleryStorageQuotaBytes = n
    }
  }

  const next = { ...current, ...patch }
  const { id: _id, ...row } = next

  if (!currentRaw) {
    await getDb().collection(COLLECTION).doc(DOC_ID).set(row)
  } else {
    const upd = await getDb().collection(COLLECTION).doc(DOC_ID).update(patch)
    // 兜底：个别情况下 update 未命中
    if (!upd || !upd.updated) {
      await getDb().collection(COLLECTION).doc(DOC_ID).set(row)
    }
  }

  const saved = await getRawDoc()
  if (!saved) {
    throw err('保存失败：未能写入 club_profile', 500)
  }
  return withDisplayUrl(toClient(saved))
}
