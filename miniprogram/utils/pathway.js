/**
 * 途径 → 色板 key（与 tokens / pathway.wxss 对齐）
 * 匹配含「观众途径」「占卜家」等写法；歌颂兼容 OCR「歌手」。
 */

const RULES = [
  { key: 'pryer', patterns: ['窥秘'] },
  { key: 'diviner', patterns: ['占卜'] },
  { key: 'audience', patterns: ['观众'] },
  { key: 'warrior', patterns: ['战士'] },
  { key: 'apprentice', patterns: ['学徒'] },
  { key: 'bard', patterns: ['歌颂', '歌手'] },
]

function resolvePathwayKey(pathway) {
  const s = String(pathway || '')
  if (!s || s === '未填写') return null
  for (const { key, patterns } of RULES) {
    if (patterns.some((p) => s.includes(p))) return key
  }
  return null
}

/** @returns {string} 如 pathway-audience；未知则空串 */
function pathwayClass(pathway) {
  const key = resolvePathwayKey(pathway)
  return key ? `pathway-${key}` : ''
}

function withPathwayClass(row) {
  if (!row || typeof row !== 'object') return row
  const cls = pathwayClass(row.pathway)
  return {
    ...row,
    pathwayClass: cls,
    pathwayTint: cls ? `${cls} pathway-tint` : '',
  }
}

function mapWithPathwayClass(list) {
  return (Array.isArray(list) ? list : []).map(withPathwayClass)
}

module.exports = {
  resolvePathwayKey,
  pathwayClass,
  withPathwayClass,
  mapWithPathwayClass,
}
