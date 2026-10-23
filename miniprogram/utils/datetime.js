/**
 * 上海时区日期展示（公告发布日等）
 */
function shanghaiParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  }
}

/** @returns {string} 如 2026-10-23；无效则空串 */
function formatDateYmd(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = shanghaiParts(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

function withPublishedText(row) {
  if (!row) return row
  const publishedText = formatDateYmd(row.publishedAt || row.createdAt)
  return { ...row, publishedText }
}

function mapWithPublishedText(list) {
  return (Array.isArray(list) ? list : []).map(withPublishedText)
}

module.exports = {
  formatDateYmd,
  withPublishedText,
  mapWithPublishedText,
}
