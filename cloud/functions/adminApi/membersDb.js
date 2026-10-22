/**
 * members 集合读写（云函数内使用 wx-server-sdk database）
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'members'

function db() {
  return cloud.database()
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return { id: _id, ...rest }
}

function err(message, status = 400) {
  const e = new Error(message)
  e.status = status
  return e
}

function sortList(list, sort = 'powerScore', order = 'desc') {
  const dir = order === 'asc' ? 1 : -1
  const numericSorts = new Set(['level', 'powerScore', 'fashionScore'])
  return list.slice().sort((a, b) => {
    const av = a[sort]
    const bv = b[sort]
    if (numericSorts.has(sort) || (typeof av === 'number' && typeof bv === 'number')) {
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh') * dir
  })
}

async function fetchAllMembers() {
  // 云开发单次默认上限 100；P0 成员量小，分页拉全
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function listMembers({ sort = 'powerScore', order = 'desc', pathway, title, q } = {}) {
  let list = (await fetchAllMembers()).map(toClient).filter((m) => m.status !== 'left')
  if (pathway) list = list.filter((m) => m.pathway === pathway)
  if (title) list = list.filter((m) => m.title === title)
  if (q) {
    const key = String(q).trim().toLowerCase()
    list = list.filter(
      (m) =>
        (m.characterName || '').toLowerCase().includes(key) ||
        (m.remark || '').toLowerCase().includes(key) ||
        (m.pathway || '').toLowerCase().includes(key),
    )
  }
  return sortList(list, sort, order)
}

async function getMember(id) {
  try {
    const res = await db().collection(COLLECTION).doc(String(id)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function findActiveByName(name) {
  const res = await db()
    .collection(COLLECTION)
    .where({ characterName: name, status: 'active' })
    .limit(1)
    .get()
  return toClient((res.data || [])[0])
}

/** 按角色名查找（含已退出），用于导入/OCR 恢复在职 */
async function findAnyByName(name) {
  const res = await db().collection(COLLECTION).where({ characterName: name }).limit(20).get()
  const rows = (res.data || []).map(toClient)
  const active = rows.find((m) => m.status === 'active')
  if (active) return active
  return rows[0] || null
}

async function createMember(payload) {
  const name = String(payload.characterName || '').trim()
  if (!name) throw err('角色名必填', 400)
  const exists = await findActiveByName(name)
  if (exists) throw err('角色名已存在', 409)
  const now = new Date().toISOString()
  const id = payload.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const row = {
    characterName: name,
    level: Number(payload.level) || 0,
    powerScore: Number(payload.powerScore) || 0,
    fashionScore: Number(payload.fashionScore) || 0,
    pathway: String(payload.pathway || '').trim() || '未填写',
    title: String(payload.title || '').trim() || '成员',
    remark: String(payload.remark || '').trim(),
    status: 'active',
    joinedAt: payload.joinedAt || now,
    createdAt: payload.createdAt || now,
    updatedAt: now,
    boundOpenid: payload.boundOpenid || null,
    lastOcrJobId: payload.lastOcrJobId || null,
  }
  await db().collection(COLLECTION).doc(id).set({ data: row })
  return { id, ...row }
}

async function updateMember(id, payload) {
  const current = await getMember(id)
  if (!current) throw err('成员不存在', 404)
  const body = payload || {}
  const patch = {}

  if (body.characterName !== undefined) {
    const name = String(body.characterName ?? '').trim()
    if (!name) throw err('角色名必填', 400)
    const other = await findActiveByName(name)
    if (other && other.id !== id) throw err('角色名已存在', 409)
    patch.characterName = name
  }
  for (const key of ['level', 'powerScore', 'fashionScore']) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      patch[key] = Number(body[key]) || 0
    } else if (body[key] === null || body[key] === '') {
      patch[key] = 0
    }
  }
  for (const key of ['pathway', 'title', 'remark', 'status']) {
    if (body[key] !== undefined) {
      patch[key] = typeof body[key] === 'string' ? String(body[key]).trim() : body[key]
    }
  }
  if (body.boundOpenid !== undefined) {
    patch.boundOpenid = body.boundOpenid || null
  }
  patch.updatedAt = new Date().toISOString()
  await db().collection(COLLECTION).doc(String(id)).update({ data: patch })
  return { ...current, ...patch }
}

/** 移出成员：status=left，并解除微信关联 */
async function deleteMember(id) {
  const current = await getMember(id)
  if (!current) throw err('成员不存在', 404)
  const openid = current.boundOpenid || null
  const updated = await updateMember(id, { status: 'left', boundOpenid: null })
  await clearUsersLinkedToMember(String(id), openid)
  await rejectPendingAppsForMember(String(id))
  return updated
}

async function clearUsersLinkedToMember(memberId, openid) {
  const col = db().collection('users')
  const rowsById = new Map()
  const remember = (rows) => {
    for (const row of rows || []) {
      if (row?._id) rowsById.set(row._id, row)
    }
  }
  try {
    const byMember = await col.where({ memberId }).limit(20).get()
    remember(byMember.data)
  } catch {
    /* ignore */
  }
  if (openid) {
    try {
      let res = await col.where({ openid }).limit(5).get()
      remember(res.data)
      res = await col.where({ _openid: openid }).limit(5).get()
      remember(res.data)
    } catch {
      /* ignore */
    }
  }
  for (const [uid, row] of rowsById) {
    try {
      const patch = { memberId: null, lastLoginAt: new Date() }
      if (row.role === 'member') patch.role = 'guest'
      await col.doc(uid).update({ data: patch })
    } catch (e) {
      console.warn('[adminApi] clear user memberId', uid, e?.message || e)
    }
  }
}

async function rejectPendingAppsForMember(memberId) {
  try {
    const col = db().collection('join_applications')
    const res = await col.where({ memberId, status: 'pending' }).limit(50).get()
    const now = new Date().toISOString()
    for (const row of res.data || []) {
      await col.doc(row._id).update({
        data: {
          status: 'rejected',
          reviewedBy: 'system',
          reviewedAt: now,
          rejectReason: '成员已移出，关联申请自动关闭',
        },
      })
    }
  } catch (e) {
    console.warn('[adminApi] reject pending apps', e?.message || e)
  }
}

async function batchUpdateScores(items) {
  const updated = []
  for (const item of items || []) {
    if (!item?.id) continue
    const patch = {}
    if (item.powerScore != null) patch.powerScore = Number(item.powerScore) || 0
    if (item.fashionScore != null) patch.fashionScore = Number(item.fashionScore) || 0
    if (!Object.keys(patch).length) continue
    updated.push(await updateMember(item.id, patch))
  }
  return updated
}

async function upsertMembersByName(rows, { ocrJobId } = {}) {
  const created = []
  const updated = []
  const skipped = []
  const now = new Date().toISOString()

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
    const patch = {
      characterName: name,
      level: Number(item.level) || 0,
      powerScore: Number(item.powerScore) || 0,
      fashionScore: Number(item.fashionScore) || 0,
      pathway: String(item.pathway || '').trim() || '未填写',
      title: String(item.title || '').trim() || '成员',
      status: 'active',
    }
    if (ocrJobId) patch.lastOcrJobId = ocrJobId

    const existing = await findAnyByName(name)
    if (existing) {
      updated.push(await updateMember(existing.id, patch))
    } else {
      created.push(
        await createMember({
          ...patch,
          remark: String(item.remark || '').trim(),
          joinedAt: now,
          createdAt: now,
        }),
      )
    }
  }
  return { created, updated, skipped }
}

/**
 * 批量导入（覆盖同 _id；按角色名跳过已存在的 active）
 * @param {Array} rows 本地 members.json 形态（含 id）
 * @param {{ mode?: 'upsert'|'skipExisting' }} opts
 */
async function importMembers(rows, { mode = 'upsert' } = {}) {
  const imported = []
  const skipped = []
  const errors = []

  for (const raw of rows || []) {
    try {
      const name = String(raw.characterName || '').trim()
      if (!name) {
        skipped.push({ characterName: '', reason: '角色名为空' })
        continue
      }
      const id = String(raw.id || raw._id || '').trim()
      const doc = {
        characterName: name,
        level: Number(raw.level) || 0,
        powerScore: Number(raw.powerScore) || 0,
        fashionScore: Number(raw.fashionScore) || 0,
        pathway: String(raw.pathway || '').trim() || '未填写',
        title: String(raw.title || '').trim() || '成员',
        remark: String(raw.remark || '').trim(),
        // 批量导入一律视为在职；仅管理端手动移出才标 left
        status: 'active',
        joinedAt: raw.joinedAt || null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString(),
        boundOpenid: raw.boundOpenid || null,
        lastOcrJobId: raw.lastOcrJobId || null,
      }

      if (id) {
        const existing = await getMember(id)
        if (existing && mode === 'skipExisting') {
          skipped.push({ characterName: name, reason: 'id 已存在' })
          continue
        }
        await db().collection(COLLECTION).doc(id).set({ data: doc })
        imported.push({ id, ...doc })
      } else if (mode === 'skipExisting') {
        const byName = await findActiveByName(name)
        if (byName) {
          skipped.push({ characterName: name, reason: '角色名已存在' })
          continue
        }
        imported.push(await createMember(doc))
      } else {
        imported.push(await createMember(doc))
      }
    } catch (e) {
      errors.push({ characterName: raw?.characterName, reason: e.message })
    }
  }

  return { imported: imported.length, skipped, errors, sample: imported.slice(0, 3) }
}

module.exports = {
  listMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  batchUpdateScores,
  upsertMembersByName,
  importMembers,
  annotateCandidates: async (candidates) => {
    const all = (await fetchAllMembers()).map(toClient)
    return (candidates || []).map((c, index) => {
      const name = String(c.characterName || '').trim()
      const matched = name ? all.find((m) => m.characterName === name) : null
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
        selected: Boolean(name),
      }
    })
  },
}
