/**
 * 成员端只读公告
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'announcements'

function db() {
  return cloud.database()
}

function toClient(doc) {
  if (!doc) return null
  const { _id, _openid, ...rest } = doc
  return {
    id: _id,
    title: String(rest.title || ''),
    content: String(rest.content || ''),
    pinned: Boolean(rest.pinned),
    publishedAt: rest.publishedAt || null,
    createdAt: rest.createdAt || null,
  }
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    const ta = new Date(a.publishedAt || a.createdAt || 0).getTime()
    const tb = new Date(b.publishedAt || b.createdAt || 0).getTime()
    return tb - ta
  })
}

/** @param {{ limit?: number }} [opts] */
async function listAnnouncements(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50)
  try {
    const res = await db().collection(COLLECTION).limit(100).get()
    const rows = sortRows((res.data || []).map(toClient).filter(Boolean))
    return rows.slice(0, limit)
  } catch {
    return []
  }
}

module.exports = {
  listAnnouncements,
}
