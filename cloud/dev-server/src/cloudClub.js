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
    updatedAt: null,
    updatedBy: null,
  }
}

function toClient(doc) {
  if (!doc) return defaults()
  const { _id, _openid, ...rest } = doc
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
  return toClient(row)
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
  return toClient(saved)
}
