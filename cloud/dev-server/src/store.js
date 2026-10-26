import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuid } from 'uuid'
import { memberMatchesPathways } from './pathwayFilter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '../data')
const membersFile = path.join(dataDir, 'members.json')
const seedFile = path.join(dataDir, 'seed-members.json')
const ocrJobsFile = path.join(dataDir, 'ocr-jobs.json')

function ensureMembersFile() {
  if (!fs.existsSync(membersFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
    fs.writeFileSync(membersFile, JSON.stringify(seed, null, 2), 'utf8')
  }
}

function readMembers() {
  ensureMembersFile()
  return JSON.parse(fs.readFileSync(membersFile, 'utf8'))
}

function writeMembers(list) {
  fs.writeFileSync(membersFile, JSON.stringify(list, null, 2), 'utf8')
}

export function listMembers({ sort = 'powerScore', order = 'desc', pathway, title, q } = {}) {
  let list = readMembers().filter((m) => m.status !== 'left')
  if (pathway) list = list.filter((m) => memberMatchesPathways(m.pathway, pathway))
  if (title) list = list.filter((m) => m.title === title)
  if (q) {
    const key = String(q).trim().toLowerCase()
    list = list.filter(
      (m) =>
        m.characterName.toLowerCase().includes(key) ||
        (m.remark || '').toLowerCase().includes(key) ||
        (m.pathway || '').toLowerCase().includes(key),
    )
  }
  const dir = order === 'asc' ? 1 : -1
  const numericSorts = new Set(['level', 'powerScore', 'fashionScore'])
  list.sort((a, b) => {
    const av = a[sort]
    const bv = b[sort]
    if (numericSorts.has(sort) || (typeof av === 'number' && typeof bv === 'number')) {
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh') * dir
  })
  return list
}

export function getMember(id) {
  return readMembers().find((m) => m.id === id) || null
}

export function createMember(payload) {
  const list = readMembers()
  const name = String(payload.characterName || '').trim()
  if (!name) throw Object.assign(new Error('角色名必填'), { status: 400 })
  const existing = list.find((m) => m.characterName === name)
  if (existing) {
    if (existing.status !== 'left') {
      throw Object.assign(new Error('角色名已存在'), { status: 409 })
    }
    const restored = updateMember(existing.id, {
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
  const row = {
    id: uuid(),
    characterName: name,
    level: Number(payload.level) || 0,
    powerScore: Number(payload.powerScore) || 0,
    fashionScore: Number(payload.fashionScore) || 0,
    pathway: String(payload.pathway || '').trim() || '未填写',
    title: String(payload.title || '').trim() || '成员',
    remark: String(payload.remark || '').trim(),
    status: 'active',
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  list.push(row)
  writeMembers(list)
  return row
}

export function updateMember(id, payload) {
  const list = readMembers()
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) throw Object.assign(new Error('成员不存在'), { status: 404 })
  const current = list[idx]
  const body = payload || {}

  if (body.characterName !== undefined) {
    const name = String(body.characterName ?? '').trim()
    if (!name) throw Object.assign(new Error('角色名必填'), { status: 400 })
    if (list.some((m) => m.id !== id && m.characterName === name)) {
      throw Object.assign(new Error('角色名已存在'), { status: 409 })
    }
    current.characterName = name
  }
  for (const key of ['level', 'powerScore', 'fashionScore']) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      current[key] = Number(body[key]) || 0
    } else if (body[key] === null || body[key] === '') {
      current[key] = 0
    }
  }
  for (const key of ['pathway', 'title', 'remark']) {
    if (body[key] !== undefined) {
      current[key] = String(body[key] ?? '').trim()
    }
  }
  if (body.status !== undefined && body.status !== null) {
    current.status = body.status
  }
  current.updatedAt = new Date().toISOString()
  list[idx] = current
  writeMembers(list)
  return current
}

export function deleteMember(id) {
  const list = readMembers()
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) throw Object.assign(new Error('成员不存在'), { status: 404 })
  list[idx].status = 'left'
  list[idx].boundOpenid = null
  list[idx].updatedAt = new Date().toISOString()
  writeMembers(list)
  return list[idx]
}

export function batchUpdateScores(items) {
  const list = readMembers()
  const now = new Date().toISOString()
  const updated = []
  for (const item of items || []) {
    const row = list.find((m) => m.id === item.id)
    if (!row) continue
    if (item.powerScore != null) row.powerScore = Number(item.powerScore) || 0
    if (item.fashionScore != null) row.fashionScore = Number(item.fashionScore) || 0
    row.updatedAt = now
    updated.push(row)
  }
  writeMembers(list)
  return updated
}

function readOcrJobs() {
  if (!fs.existsSync(ocrJobsFile)) return []
  return JSON.parse(fs.readFileSync(ocrJobsFile, 'utf8'))
}

function writeOcrJobs(list) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(ocrJobsFile, JSON.stringify(list, null, 2), 'utf8')
}

export function createOcrJob({ createdBy, imageNames, rawText, candidates }) {
  const jobs = readOcrJobs()
  const now = new Date().toISOString()
  const job = {
    id: uuid(),
    imageFileIds: imageNames || [],
    status: 'parsed',
    rawText: rawText || null,
    candidates: candidates || [],
    committedAt: null,
    createdBy: createdBy || '',
    createdAt: now,
  }
  jobs.unshift(job)
  // 仅保留最近 30 个任务，避免本地文件膨胀
  writeOcrJobs(jobs.slice(0, 30))
  return job
}

export function getOcrJob(id) {
  return readOcrJobs().find((j) => j.id === id) || null
}

export function annotateCandidates(candidates) {
  const list = readMembers()
  return (candidates || []).map((c, index) => {
    const name = String(c.characterName || '').trim()
    const matched = name ? list.find((m) => m.characterName === name) : null
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
      // 角色名受头像干扰时常见缺字，默认勾选但仍标红提醒核对
      selected: Boolean(name),
    }
  })
}

/**
 * 按角色名新增或更新（截图导入确认提交）
 */
export function upsertMembersByName(rows, { ocrJobId } = {}) {
  const list = readMembers()
  const now = new Date().toISOString()
  const created = []
  const updated = []
  const skipped = []

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
    // 含已退出：同角色名再次导入则恢复在职
    const idx = list.findIndex((m) => m.characterName === name)
    const patch = {
      characterName: name,
      level: Number(item.level) || 0,
      powerScore: Number(item.powerScore) || 0,
      fashionScore: Number(item.fashionScore) || 0,
      pathway: String(item.pathway || '').trim() || '未填写',
      title: String(item.title || '').trim() || '成员',
      status: 'active',
      updatedAt: now,
    }
    if (ocrJobId) patch.lastOcrJobId = ocrJobId

    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        ...patch,
        remark: list[idx].remark || '',
      }
      updated.push(list[idx])
    } else {
      const row = {
        id: uuid(),
        ...patch,
        remark: String(item.remark || '').trim(),
        status: 'active',
        joinedAt: now,
        createdAt: now,
        boundOpenid: null,
        lastOcrJobId: ocrJobId || null,
      }
      list.push(row)
      created.push(row)
    }
  }

  writeMembers(list)

  if (ocrJobId) {
    const jobs = readOcrJobs()
    const job = jobs.find((j) => j.id === ocrJobId)
    if (job) {
      job.status = 'committed'
      job.committedAt = now
      writeOcrJobs(jobs)
    }
  }

  return { created, updated, skipped }
}

/**
 * 应急账号来自环境变量（cloud/dev-server/.env），勿写进仓库与页面。
 * 须在 index.js 加载 .env 之后再调用（登录时读取即可）。
 */
export function getEmergencyAccounts() {
  const accounts = []
  const superUser = String(process.env.EMERGENCY_SUPER_USERNAME || '').trim()
  const superPass = String(process.env.EMERGENCY_SUPER_PASSWORD || '')
  if (superUser && superPass) {
    accounts.push({
      username: superUser,
      password: superPass,
      role: 'super_admin',
      displayName:
        String(process.env.EMERGENCY_SUPER_DISPLAY_NAME || '').trim() || '超管（应急）',
    })
  }
  const adminUser = String(process.env.EMERGENCY_ADMIN_USERNAME || '').trim()
  const adminPass = String(process.env.EMERGENCY_ADMIN_PASSWORD || '')
  if (adminUser && adminPass) {
    accounts.push({
      username: adminUser,
      password: adminPass,
      role: 'admin',
      displayName:
        String(process.env.EMERGENCY_ADMIN_DISPLAY_NAME || '').trim() || '管理员（应急）',
    })
  }
  return accounts
}

const sessions = new Map()

export function login(username, password) {
  const account = getEmergencyAccounts().find(
    (a) => a.username === username && a.password === password,
  )
  if (!account) throw Object.assign(new Error('账号或密码错误'), { status: 401 })
  const token = uuid()
  sessions.set(token, {
    username: account.username,
    role: account.role,
    displayName: account.displayName,
    createdAt: Date.now(),
  })
  return {
    token,
    role: account.role,
    displayName: account.displayName,
    username: account.username,
  }
}

export function authFromToken(token) {
  if (!token) return null
  return sessions.get(token) || null
}

/** 扫码登录成功后签发与应急登录相同形态的本地 session */
export function createSessionFromWechat({ username, role, displayName, openid }) {
  if (!['super_admin', 'admin'].includes(role)) {
    throw Object.assign(new Error('非管理员角色'), { status: 403 })
  }
  const token = uuid()
  sessions.set(token, {
    username: username || `wx_${String(openid || '').slice(-6) || 'admin'}`,
    role,
    displayName: displayName || '管理员',
    openid: openid || null,
    createdAt: Date.now(),
  })
  const user = sessions.get(token)
  return {
    token,
    role: user.role,
    displayName: user.displayName,
    username: user.username,
  }
}
