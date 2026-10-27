/**
 * 上海时区日期展示（公告发布日等）
 * 真机基础库偶发不支持 Intl/timeZone，须兜底，避免整表渲染被 catch 成空。
 */
function shanghaiParts(date) {
  try {
    if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) throw new Error('no Intl')
    const partsArr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date)
    const parts = {}
    for (let i = 0; i < partsArr.length; i++) {
      const p = partsArr[i]
      if (p.type !== 'literal') parts[p.type] = p.value
    }
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
    }
  } catch {
    // UTC+8 近似兜底
    const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    }
  }
}

/** @returns {string} 如 2026-10-23；无效则空串 */
function formatDateYmd(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const p = shanghaiParts(d)
    if (!p.year || !p.month || !p.day) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`
  } catch {
    return ''
  }
}

function withPublishedText(row) {
  if (!row) return row
  const publishedText = formatDateYmd(row.publishedAt || row.createdAt)
  return Object.assign({}, row, { publishedText })
}

function mapWithPublishedText(list) {
  const arr = Array.isArray(list) ? list : []
  const out = []
  for (let i = 0; i < arr.length; i++) {
    try {
      out.push(withPublishedText(arr[i]))
    } catch {
      out.push(arr[i])
    }
  }
  return out
}

module.exports = {
  formatDateYmd,
  withPublishedText,
  mapWithPublishedText,
}
