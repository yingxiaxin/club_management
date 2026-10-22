/**
 * 成员端：members 只读 + 按角色名绑定
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
    if (sort === 'joinedAt') {
      const at = av ? new Date(av).getTime() : 0
      const bt = bv ? new Date(bv).getTime() : 0
      return (at - bt) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh') * dir
  })
}

async function fetchAllMembers() {
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

async function bindByCharacterName(openid, characterName) {
  if (!openid) throw err('无法获取微信身份', 401)
  const name = String(characterName || '').trim()
  if (!name) throw err('请填写角色名', 400)

  const member = await findActiveByName(name)
  if (!member) throw err('未找到该角色名，请确认与俱乐部名单一致', 404)
  if (member.boundOpenid && member.boundOpenid !== openid) {
    throw err('该角色已被其他微信绑定', 409)
  }

  const now = new Date().toISOString()
  if (member.boundOpenid !== openid) {
    await db().collection(COLLECTION).doc(String(member.id)).update({
      data: { boundOpenid: openid, updatedAt: now },
    })
  }

  return {
    id: member.id,
    characterName: member.characterName,
    title: member.title,
    pathway: member.pathway,
    powerScore: member.powerScore,
    fashionScore: member.fashionScore,
    level: member.level,
  }
}

module.exports = {
  listMembers,
  getMember,
  bindByCharacterName,
}
