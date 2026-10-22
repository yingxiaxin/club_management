/**
 * 成员端：活动出席意向 activity_rsvps
 * 文档 id：`${activityId}__${memberId}` 保证一人一活动唯一
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'activity_rsvps'
const MEMBERS = 'members'
const STATUSES = new Set(['going', 'maybe', 'decline'])
const STATUS_LABELS = {
  going: '参加',
  maybe: '待定',
  decline: '请假',
}

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

function docId(activityId, memberId) {
  return `${String(activityId)}__${String(memberId)}`
}

async function ensureCollection() {
  if (collectionsReady) return
  try {
    await db().createCollection(COLLECTION)
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (!/exist|已存在|RESOURCE_EXIST|DATABASE_COLLECTION_EXIST/i.test(msg)) {
      console.warn('[rsvpsDb] createCollection', msg)
    }
  }
  collectionsReady = true
}

async function listByActivity(activityId) {
  await ensureCollection()
  const id = String(activityId)
  const pageSize = 100
  let offset = 0
  const all = []
  for (;;) {
    const res = await db()
      .collection(COLLECTION)
      .where({ activityId: id })
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

async function getMine(activityId, memberId) {
  if (!activityId || !memberId) return null
  await ensureCollection()
  try {
    const res = await db().collection(COLLECTION).doc(docId(activityId, memberId)).get()
    return toClient(res.data)
  } catch {
    return null
  }
}

async function fetchMemberNames(memberIds) {
  const ids = [...new Set(memberIds.filter(Boolean).map(String))]
  const map = new Map()
  for (const id of ids) {
    try {
      const res = await db().collection(MEMBERS).doc(id).get()
      const row = res.data
      map.set(id, (row && row.characterName) || id)
    } catch {
      map.set(id, id)
    }
  }
  return map
}

/**
 * @returns {{
 *   counts: { going:number, maybe:number, decline:number, total:number },
 *   groups: { going:object[], maybe:object[], decline:object[] },
 *   myStatus: string|null
 * }}
 */
async function summarize(activityId, memberId = null) {
  const rows = await listByActivity(activityId)
  const nameMap = await fetchMemberNames(rows.map((r) => r.memberId))
  const groups = { going: [], maybe: [], decline: [] }
  const counts = { going: 0, maybe: 0, decline: 0, total: 0 }

  for (const row of rows) {
    const status = STATUSES.has(row.status) ? row.status : null
    if (!status) continue
    const item = {
      memberId: row.memberId,
      characterName:
        row.characterName ||
        nameMap.get(String(row.memberId)) ||
        row.memberId,
      status,
      statusLabel: STATUS_LABELS[status],
      updatedAt: row.updatedAt || null,
    }
    groups[status].push(item)
    counts[status] += 1
    counts.total += 1
  }

  for (const key of ['going', 'maybe', 'decline']) {
    groups[key].sort((a, b) =>
      String(a.characterName).localeCompare(String(b.characterName), 'zh'),
    )
  }

  let myStatus = null
  if (memberId) {
    const mine = rows.find((r) => String(r.memberId) === String(memberId))
    myStatus = mine && STATUSES.has(mine.status) ? mine.status : null
  }

  return { counts, groups, myStatus }
}

/** 仅人数，供列表批量挂载 */
async function countByActivityIds(activityIds) {
  await ensureCollection()
  const ids = [...new Set((activityIds || []).map(String).filter(Boolean))]
  const empty = () => ({ going: 0, maybe: 0, decline: 0, total: 0 })
  const result = new Map(ids.map((id) => [id, empty()]))
  if (!ids.length) return result

  // 拉取本周相关活动的全部 rsvp：活动不多时全表扫描可接受
  const pageSize = 100
  let offset = 0
  for (;;) {
    const res = await db().collection(COLLECTION).skip(offset).limit(pageSize).get()
    const rows = (res.data || []).map(toClient)
    for (const row of rows) {
      const bucket = result.get(String(row.activityId))
      if (!bucket || !STATUSES.has(row.status)) continue
      bucket[row.status] += 1
      bucket.total += 1
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return result
}

async function upsert({ activityId, memberId, status, characterName }) {
  await ensureCollection()
  const aid = String(activityId || '').trim()
  const mid = String(memberId || '').trim()
  const st = String(status || '').trim()
  if (!aid) throw err('缺少活动 id', 400)
  if (!mid) throw err('缺少成员 id', 400)
  if (!STATUSES.has(st)) throw err('意向无效，须为 going/maybe/decline', 400)

  const now = new Date().toISOString()
  const id = docId(aid, mid)
  const row = {
    activityId: aid,
    memberId: mid,
    characterName: String(characterName || '').trim(),
    status: st,
    updatedAt: now,
  }

  const existing = await getMine(aid, mid)
  if (existing) {
    await db().collection(COLLECTION).doc(id).update({
      data: {
        status: st,
        characterName: row.characterName,
        updatedAt: now,
      },
    })
  } else {
    await db()
      .collection(COLLECTION)
      .doc(id)
      .set({ data: { ...row, createdAt: now } })
  }
  return { id, ...row }
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  listByActivity,
  getMine,
  summarize,
  countByActivityIds,
  upsert,
  ensureCollection,
}
