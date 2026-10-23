/** 组队状态文案（P2） */

const TEAM_STATUS_LABELS = {
  recruiting: '招募中',
  full: '已满员',
  paused: '已关招募',
  started: '已开始',
  dissolved: '已撤销',
  closed: '已撤销',
}

const APP_STATUS_LABELS = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  kicked: '被踢出',
}

function teamStatusLabel(status) {
  return TEAM_STATUS_LABELS[status] || status || ''
}

function appStatusLabel(status) {
  return APP_STATUS_LABELS[status] || status || ''
}

function formatStartAt(iso) {
  if (!iso) return '未定开打时间'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 上海日历日 + 时间 → ISO（+08:00） */
function shanghaiToIso(dateStr, timeStr) {
  const date = String(dateStr || '').trim()
  if (!date) return null
  const time = String(timeStr || '00:00').trim() || '00:00'
  return `${date}T${time}:00+08:00`
}

module.exports = {
  TEAM_STATUS_LABELS,
  APP_STATUS_LABELS,
  teamStatusLabel,
  appStatusLabel,
  formatStartAt,
  shanghaiToIso,
}
