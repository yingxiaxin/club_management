/**
 * 活动日程匹配（纯函数，无云依赖）—— 今日/本周须兼容 startSchedule 分量
 */

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

const TYPE_LABELS = {
  daily: '日常',
  weekly: '周本',
  pvp: 'PVP',
  custom: '自定义',
}

const STATUS_LABELS = {
  published: '已发布',
  ongoing: '进行中',
  ended: '已结束',
  cancelled: '已取消',
  draft: '草稿',
}

/** 上海时区日历分量 */
function shanghaiParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const hour = String(parts.hour === '24' ? '00' : parts.hour).padStart(2, '0')
  const minute = String(parts.minute || '0').padStart(2, '0')
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday] || 1,
    time: `${hour}:${minute}`,
  }
}

/** 当前周周一～周日（上海）日历分量 */
function weekDayParts(anchor = new Date()) {
  const today = shanghaiParts(anchor)
  const noonUtc = Date.UTC(today.year, today.month - 1, today.day, 4, 0, 0)
  const offsetToMonday = today.weekday - 1
  const days = []
  for (let i = 0; i < 7; i++) {
    const ms = noonUtc + (i - offsetToMonday) * 24 * 60 * 60 * 1000
    days.push(shanghaiParts(new Date(ms)))
  }
  return { today, days }
}

function scheduleFromIso(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return shanghaiParts(d)
}

function resolveStartSchedule(activity) {
  const s = activity?.startSchedule
  if (s && typeof s === 'object') {
    const hasAny =
      s.year != null ||
      s.month != null ||
      s.day != null ||
      s.weekday != null ||
      Boolean(s.time)
    if (hasAny) {
      return {
        year: s.year ?? null,
        month: s.month ?? null,
        day: s.day ?? null,
        weekday: s.weekday ?? null,
        time: s.time || null,
      }
    }
  }
  return scheduleFromIso(activity?.startAt)
}

/**
 * 活动是否在某日历日「发生」：
 * - 有完整年月日（或 startAt）：只匹配该日
 * - 否则对已填分量做 AND；仅时间 → 每天；仅周几 → 该周几
 */
function matchesCalendarDay(activity, dayParts) {
  const schedule = resolveStartSchedule(activity)
  if (!schedule) return false

  const fullDate =
    schedule.year != null && schedule.month != null && schedule.day != null
  if (fullDate || activity.startAt) {
    const abs = fullDate
      ? schedule
      : scheduleFromIso(activity.startAt) || schedule
    return (
      abs.year === dayParts.year &&
      abs.month === dayParts.month &&
      abs.day === dayParts.day
    )
  }

  if (schedule.year != null && schedule.year !== dayParts.year) return false
  if (schedule.month != null && schedule.month !== dayParts.month) return false
  if (schedule.day != null && schedule.day !== dayParts.day) return false
  if (schedule.weekday != null && schedule.weekday !== dayParts.weekday) return false
  return true
}

function timeSortKey(schedule) {
  if (!schedule?.time) return 24 * 60 + 1
  const m = String(schedule.time).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 24 * 60 + 1
  return Number(m[1]) * 60 + Number(m[2])
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 上海本地年月日 + HH:mm → epoch ms */
function shanghaiDateTimeMs(year, month, day, time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(Number(m[1]))}:${m[2]}:00+08:00`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/**
 * 本周内最相关的一次开始时刻：优先下一场未开始；否则最近一场已开始
 * 无开始时间则无法算紧迫度，返回 null
 */
function resolveRelevantStartMs(activity, now = new Date()) {
  const schedule = resolveStartSchedule(activity)
  if (!schedule) return null

  if (activity.startAt) {
    const t = new Date(activity.startAt).getTime()
    return Number.isNaN(t) ? null : t
  }
  if (
    schedule.year != null &&
    schedule.month != null &&
    schedule.day != null &&
    schedule.time
  ) {
    return shanghaiDateTimeMs(schedule.year, schedule.month, schedule.day, schedule.time)
  }
  if (!schedule.time) return null

  const today = shanghaiParts(now)
  const noonUtc = Date.UTC(today.year, today.month - 1, today.day, 4, 0, 0)
  const candidates = []
  for (let i = 0; i < 7; i++) {
    const day = shanghaiParts(new Date(noonUtc + i * 86400000))
    if (!matchesCalendarDay(activity, day)) continue
    const ms = shanghaiDateTimeMs(day.year, day.month, day.day, schedule.time)
    if (ms != null) candidates.push(ms)
  }
  if (!candidates.length) return null
  const nowMs = now.getTime()
  const future = candidates.filter((t) => t >= nowMs).sort((a, b) => a - b)
  if (future.length) return future[0]
  return Math.max(...candidates)
}

const URGENCY_ICONS = { hot: '🔥', soon: '⏰', calm: '🍃' }

/**
 * 紧迫档：≤10 分钟（含已开始）hot；≤1 小时 soon；更远 calm；无时间 null
 */
function resolveUrgency(activity, now = new Date()) {
  const startMs = resolveRelevantStartMs(activity, now)
  if (startMs == null) {
    return { urgency: null, urgencyIcon: '', minutesUntil: null }
  }
  const minutesUntil = Math.round((startMs - now.getTime()) / 60000)
  let urgency = 'calm'
  if (minutesUntil <= 10) urgency = 'hot'
  else if (minutesUntil <= 60) urgency = 'soon'
  return {
    urgency,
    urgencyIcon: URGENCY_ICONS[urgency],
    minutesUntil,
  }
}

/**
 * 解析提醒周期：显式 none 保留；缺字段但有提前量+时间时按分量推断（兼容模板时代旧数据）
 */
function resolveReminderCycle(activity, schedule, offsets) {
  const raw = activity?.reminderCycle
  if (raw === 'none') return 'none'
  if (raw && ['once', 'daily', 'weekly', 'monthly'].includes(raw)) return raw
  if (!Array.isArray(offsets) || !offsets.length) return 'none'
  if (!schedule?.time) return 'none'
  const full =
    schedule.year != null && schedule.month != null && schedule.day != null
  if (full) return 'once'
  if (schedule.day != null) return 'once'
  if (schedule.weekday != null) return 'weekly'
  return 'daily'
}

function formatScheduleText(schedule) {
  if (!schedule) return '时间待定'
  const parts = []
  if (schedule.year != null || schedule.month != null || schedule.day != null) {
    const y = schedule.year != null ? `${schedule.year}年` : ''
    const m = schedule.month != null ? `${schedule.month}月` : ''
    const d = schedule.day != null ? `${schedule.day}日` : ''
    parts.push(`${y}${m}${d}`)
  }
  if (schedule.weekday != null) {
    parts.push(WEEKDAY_LABELS[schedule.weekday] || `周${schedule.weekday}`)
  }
  if (schedule.time) parts.push(schedule.time)
  return parts.join(' ') || '时间待定'
}

function decorate(activity, now = new Date()) {
  const startSchedule = resolveStartSchedule(activity)
  const endSchedule =
    activity.endSchedule && typeof activity.endSchedule === 'object'
      ? {
          year: activity.endSchedule.year ?? null,
          month: activity.endSchedule.month ?? null,
          day: activity.endSchedule.day ?? null,
          weekday: activity.endSchedule.weekday ?? null,
          time: activity.endSchedule.time || null,
        }
      : scheduleFromIso(activity.endAt)
  const urgencyInfo = resolveUrgency(activity, now)
  const startMs = resolveRelevantStartMs(activity, now)
  let canChangeRsvp = true
  let rsvpLockedReason = ''
  if (activity.status === 'ongoing') {
    canChangeRsvp = false
    rsvpLockedReason = '活动进行中，无法修改意向'
  } else if (activity.status && activity.status !== 'published') {
    canChangeRsvp = false
    rsvpLockedReason = '当前活动状态不可表态'
  } else if (startMs != null && startMs <= now.getTime()) {
    canChangeRsvp = false
    rsvpLockedReason = '活动已开始，无法修改意向'
  }

  const reminderOffsetsMinutes = Array.isArray(activity.reminderOffsetsMinutes)
    ? activity.reminderOffsetsMinutes
    : []
  // 旧数据可能只有提前量、无 reminderCycle（管理端编辑框会因「完整日期」自动显示「一次」）
  const reminderCycle = resolveReminderCycle(activity, startSchedule, reminderOffsetsMinutes)

  return {
    id: activity.id,
    title: activity.title || '',
    type: activity.type || 'custom',
    typeLabel: TYPE_LABELS[activity.type] || activity.type || '自定义',
    status: activity.status,
    statusLabel: STATUS_LABELS[activity.status] || activity.status,
    description: activity.description || '',
    enableTeam: Boolean(activity.enableTeam),
    startSchedule,
    endSchedule,
    startAt: activity.startAt || null,
    endAt: activity.endAt || null,
    startText: formatScheduleText(startSchedule),
    endText: endSchedule ? formatScheduleText(endSchedule) : '',
    reminderCycle,
    reminderOffsetsMinutes,
    urgency: urgencyInfo.urgency,
    urgencyClass: urgencyInfo.urgency ? `urgency-${urgencyInfo.urgency}` : '',
    urgencyIcon: urgencyInfo.urgencyIcon,
    minutesUntil: urgencyInfo.minutesUntil,
    canChangeRsvp,
    rsvpLockedReason,
  }
}

function sortActivities(list) {
  return list.slice().sort((a, b) => {
    const ta = timeSortKey(a.startSchedule)
    const tb = timeSortKey(b.startSchedule)
    if (ta !== tb) return ta - tb
    const wa = a.startSchedule?.weekday ?? 99
    const wb = b.startSchedule?.weekday ?? 99
    if (wa !== wb) return wa - wb
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh')
  })
}

/**
 * 从可见活动列表拆出今日 / 本周
 */
function splitSchedule(visibleList, now = new Date()) {
  const { today: todayParts, days } = weekDayParts(now)
  const today = []
  const weekMap = new Map()

  for (const raw of visibleList) {
    const item = decorate(raw, now)
    if (matchesCalendarDay(raw, todayParts)) today.push(item)
    for (const day of days) {
      if (matchesCalendarDay(raw, day)) {
        weekMap.set(item.id, item)
        break
      }
    }
  }

  return {
    today: sortActivities(today),
    week: sortActivities([...weekMap.values()]),
    meta: {
      timezone: 'Asia/Shanghai',
      today: {
        year: todayParts.year,
        month: todayParts.month,
        day: todayParts.day,
        weekday: todayParts.weekday,
        weekdayLabel: WEEKDAY_LABELS[todayParts.weekday],
      },
      weekStart: {
        year: days[0].year,
        month: days[0].month,
        day: days[0].day,
      },
      weekEnd: {
        year: days[6].year,
        month: days[6].month,
        day: days[6].day,
      },
    },
  }
}

module.exports = {
  shanghaiParts,
  weekDayParts,
  resolveStartSchedule,
  matchesCalendarDay,
  resolveRelevantStartMs,
  resolveUrgency,
  decorate,
  splitSchedule,
  formatScheduleText,
  WEEKDAY_LABELS,
  TYPE_LABELS,
  STATUS_LABELS,
}
