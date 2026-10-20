import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuid } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '../data')
const membersFile = path.join(dataDir, 'members.json')
const seedFile = path.join(dataDir, 'seed-members.json')

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
  if (pathway) list = list.filter((m) => m.pathway === pathway)
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
  list.sort((a, b) => {
    const av = a[sort]
    const bv = b[sort]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
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
  if (list.some((m) => m.characterName === name && m.status !== 'left')) {
    throw Object.assign(new Error('角色名已存在'), { status: 409 })
  }
  const now = new Date().toISOString()
  const row = {
    id: uuid(),
    characterName: name,
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
  if (payload.characterName != null) {
    const name = String(payload.characterName).trim()
    if (!name) throw Object.assign(new Error('角色名必填'), { status: 400 })
    if (list.some((m) => m.id !== id && m.characterName === name && m.status !== 'left')) {
      throw Object.assign(new Error('角色名已存在'), { status: 409 })
    }
    current.characterName = name
  }
  for (const key of ['powerScore', 'fashionScore']) {
    if (payload[key] != null) current[key] = Number(payload[key]) || 0
  }
  for (const key of ['pathway', 'title', 'remark']) {
    if (payload[key] != null) current[key] = String(payload[key]).trim()
  }
  if (payload.status != null) current.status = payload.status
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

/** 应急账号：本地开发默认，上线务必修改 */
export const EMERGENCY_ACCOUNTS = [
  {
    username: 'superadmin',
    password: 'club-change-me',
    role: 'super_admin',
    displayName: '超管（应急）',
  },
  {
    username: 'admin',
    password: 'club-change-me',
    role: 'admin',
    displayName: '管理员（应急）',
  },
]

const sessions = new Map()

export function login(username, password) {
  const account = EMERGENCY_ACCOUNTS.find(
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
