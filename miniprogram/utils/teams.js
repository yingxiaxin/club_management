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

/** Asia/Shanghai 的 YYYY-MM-DD */
function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** 上海时区：周一=0 … 周日=6 */
function shanghaiWeekdayMon0(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(date)
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  return map[wd] ?? 0
}

function addCalendarDays(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d + delta)
  const x = new Date(ms)
  const yy = x.getUTCFullYear()
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(x.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * P2-c 时间筛：今天 / 本周（上海日历日）。
 * 优先用队伍 startAt；若无则可用活动本场 occurrenceDateKey（YYYY-MM-DD）兜底。
 * @param {string|null|undefined} startAt
 * @param {''|'today'|'tonight'|'week'} timeFilter  tonight 兼容旧值，等同 today
 * @param {string|null|undefined} [dateKeyFallback]
 */
function matchTeamTimeFilter(startAt, timeFilter, dateKeyFallback) {
  let key = String(timeFilter || '').trim()
  if (key === 'tonight') key = 'today'
  if (!key) return true
  let ymd = ''
  if (startAt) {
    const d = new Date(startAt)
    if (!Number.isNaN(d.getTime())) ymd = shanghaiYmd(d)
  }
  if (!ymd && dateKeyFallback) ymd = String(dateKeyFallback).trim()
  if (!ymd) return false
  const today = shanghaiYmd(new Date())
  if (key === 'today') return ymd === today
  if (key === 'week') {
    const mon0 = shanghaiWeekdayMon0(new Date())
    const monday = addCalendarDays(today, -mon0)
    const sunday = addCalendarDays(monday, 6)
    return ymd >= monday && ymd <= sunday
  }
  return true
}

/**
 * @param {{ myIsLeader?: boolean, myInTeam?: boolean }} team
 * @param {''|'created'|'joined'} mineFilter
 */
function matchTeamMineFilter(team, mineFilter) {
  const key = String(mineFilter || '').trim()
  if (!key) return true
  if (key === 'created') return Boolean(team.myIsLeader)
  if (key === 'joined') return Boolean(team.myInTeam)
  return true
}

module.exports = {
  TEAM_STATUS_LABELS,
  APP_STATUS_LABELS,
  teamStatusLabel,
  appStatusLabel,
  formatStartAt,
  shanghaiToIso,
  shanghaiYmd,
  matchTeamTimeFilter,
  matchTeamMineFilter,
}
