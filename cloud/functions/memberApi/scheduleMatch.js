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

/** 是否锚定到具体一场（绝对时刻或完整年月日+时间）；周期模板（仅周几/每日）为 false */
function isAnchoredStart(activity) {
  if (activity?.startAt) return true
  const schedule = resolveStartSchedule(activity)
  return Boolean(
    schedule &&
      schedule.year != null &&
      schedule.month != null &&
      schedule.day != null &&
      schedule.time,
  )
}

function isPeriodicTemplate(activity) {
  return !isAnchoredStart(activity)
}

function dateKeyFromParts(parts) {
  if (!parts || parts.year == null || parts.month == null || parts.day == null) return null
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function endOfShanghaiDayMs(year, month, day) {
  const iso = `${year}-${pad2(month)}-${pad2(day)}T23:59:59+08:00`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function normalizeEndSchedule(activity) {
  if (activity?.endSchedule && typeof activity.endSchedule === 'object') {
    const s = activity.endSchedule
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
  return scheduleFromIso(activity?.endAt)
}

/** 本场结束时刻：endAt / 完整结束日+时 / 仅时刻落在开始日；否则开始日 23:59:59 */
function resolveOccurrenceEndMs(activity, startMs, startParts) {
  if (activity?.endAt) {
    const t = new Date(activity.endAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  const endSch = normalizeEndSchedule(activity)
  if (
    endSch &&
    endSch.year != null &&
    endSch.month != null &&
    endSch.day != null &&
    endSch.time
  ) {
    const ms = shanghaiDateTimeMs(endSch.year, endSch.month, endSch.day, endSch.time)
    if (ms != null) return ms
  }
  if (endSch?.time && startParts) {
    const ms = shanghaiDateTimeMs(
      startParts.year,
      startParts.month,
      startParts.day,
      endSch.time,
    )
    if (ms != null) return ms
  }
  if (startParts) {
    return endOfShanghaiDayMs(startParts.year, startParts.month, startParts.day)
  }
  if (startMs != null) return startMs
  return null
}

function startMsOnDay(schedule, dayParts) {
  if (!schedule) return null
  if (schedule.time) {
    return shanghaiDateTimeMs(dayParts.year, dayParts.month, dayParts.day, schedule.time)
  }
  return shanghaiDateTimeMs(dayParts.year, dayParts.month, dayParts.day, '00:00')
}

/**
 * 枚举候选场次开始（锚定一场；周期扫过去 7 天～未来 21 天）
 */
function enumerateOccurrenceStarts(activity, now = new Date()) {
  const schedule = resolveStartSchedule(activity)
  if (!schedule) return []

  if (activity.startAt) {
    const ms = new Date(activity.startAt).getTime()
    if (Number.isNaN(ms)) return []
    const parts = shanghaiParts(new Date(ms))
    return [{ ms, parts }]
  }
  if (
    schedule.year != null &&
    schedule.month != null &&
    schedule.day != null
  ) {
    const ms = startMsOnDay(schedule, {
      year: schedule.year,
      month: schedule.month,
      day: schedule.day,
      weekday: schedule.weekday,
    })
    if (ms == null) return []
    const parts = shanghaiParts(new Date(ms))
    return [{ ms, parts }]
  }

  const today = shanghaiParts(now)
  const noonUtc = Date.UTC(today.year, today.month - 1, today.day, 4, 0, 0)
  const out = []
  for (let i = -7; i <= 21; i++) {
    const day = shanghaiParts(new Date(noonUtc + i * 86400000))
    if (!matchesCalendarDay(activity, day)) continue
    const ms = startMsOnDay(schedule, day)
    if (ms != null) out.push({ ms, parts: day })
  }
  return out
}

function formatOccurrenceLabel(parts, time) {
  if (!parts) return '时间待定'
  const wd = WEEKDAY_LABELS[parts.weekday] || ''
  const dateBit = `${parts.month}月${parts.day}日`
  const bits = [dateBit]
  if (wd) bits.push(wd)
  if (time) bits.push(time)
  return bits.join(' ')
}

/**
 * 当前展示场次：进行中 → 今日已结束场 → 下一场未开始 → 最近已结束
 */
function resolveOccurrence(activity, now = new Date()) {
  const schedule = resolveStartSchedule(activity)
  const nowMs = now.getTime()
  const isPeriodic = isPeriodicTemplate(activity)
  const starts = enumerateOccurrenceStarts(activity, now)
  if (!starts.length) {
    return {
      isPeriodic,
      dateKey: null,
      dateParts: null,
      startMs: null,
      endMs: null,
      started: false,
      ended: false,
      label: formatScheduleText(schedule),
      nextDateKey: null,
      nextLabel: '',
    }
  }

  const windows = starts.map((s) => {
    const endMs = resolveOccurrenceEndMs(activity, s.ms, s.parts)
    return {
      ms: s.ms,
      parts: s.parts,
      endMs,
      dateKey: dateKeyFromParts(s.parts),
    }
  })

  let current = windows.find((w) => w.ms <= nowMs && w.endMs != null && nowMs < w.endMs)
  if (!current) {
    const todayKey = dateKeyFromParts(shanghaiParts(now))
    current = windows.find((w) => w.dateKey === todayKey && w.endMs != null && nowMs >= w.endMs)
  }
  if (!current) {
    const upcoming = windows.filter((w) => w.ms > nowMs).sort((a, b) => a.ms - b.ms)
    current = upcoming[0] || null
  }
  if (!current) {
    const past = windows
      .filter((w) => w.endMs != null && w.endMs <= nowMs)
      .sort((a, b) => b.endMs - a.endMs)
    current = past[0] || windows[0]
  }

  const next =
    windows.filter((w) => w.ms > current.ms).sort((a, b) => a.ms - b.ms)[0] || null
  const time = schedule?.time || null
  const ended = current.endMs != null && nowMs >= current.endMs
  const started = current.ms != null && nowMs >= current.ms

  return {
    isPeriodic,
    dateKey: current.dateKey,
    dateParts: current.parts,
    startMs: current.ms,
    endMs: current.endMs,
    started,
    ended,
    label: formatOccurrenceLabel(current.parts, time),
    nextDateKey: next?.dateKey || null,
    nextLabel: next ? formatOccurrenceLabel(next.parts, time) : '',
  }
}

/**
 * 本周内最相关的一次开始时刻：优先用 resolveOccurrence
 */
function resolveRelevantStartMs(activity, now = new Date()) {
  const occ = resolveOccurrence(activity, now)
  return occ.startMs
}

const URGENCY_ICONS = { hot: '🔥', soon: '⏰', calm: '🍃' }

/**
 * 紧迫档：未结束场次按距开始；已结束不再标紧迫
 */
function resolveUrgency(activity, now = new Date()) {
  const occ = resolveOccurrence(activity, now)
  if (occ.startMs == null || occ.ended) {
    return { urgency: null, urgencyIcon: '', minutesUntil: null }
  }
  const minutesUntil = Math.round((occ.startMs - now.getTime()) / 60000)
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

function sameCalendarDay(a, b) {
  return (
    a &&
    b &&
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day
  )
}

function decorate(activity, now = new Date()) {
  const startSchedule = resolveStartSchedule(activity)
  const endSchedule = normalizeEndSchedule(activity)
  const occ = resolveOccurrence(activity, now)
  const urgencyInfo = resolveUrgency(activity, now)

  let canChangeRsvp = true
  let rsvpLockedReason = ''
  const st = activity.status
  if (st === 'ended' || st === 'cancelled' || st === 'draft') {
    canChangeRsvp = false
    rsvpLockedReason =
      st === 'ended' ? '活动已结束，无法报名' : '当前活动状态不可表态'
  } else if (st && st !== 'published' && st !== 'ongoing') {
    canChangeRsvp = false
    rsvpLockedReason = '当前活动状态不可表态'
  } else if (occ.ended) {
    canChangeRsvp = false
    rsvpLockedReason = '活动已结束，无法报名'
  }

  const reminderOffsetsMinutes = Array.isArray(activity.reminderOffsetsMinutes)
    ? activity.reminderOffsetsMinutes
    : []
  const reminderCycle = resolveReminderCycle(activity, startSchedule, reminderOffsetsMinutes)

  const startText = occ.label || formatScheduleText(startSchedule)
  let endText = ''
  if (endSchedule) {
    if (endSchedule.time && occ.dateParts && endSchedule.year == null) {
      endText = formatOccurrenceLabel(occ.dateParts, endSchedule.time)
    } else {
      endText = formatScheduleText(endSchedule)
    }
  }

  let occurrencePhase = 'upcoming'
  let occurrencePhaseLabel = '未开始'
  if (occ.ended) {
    occurrencePhase = 'ended'
    occurrencePhaseLabel = '已结束'
  } else if (occ.started) {
    occurrencePhase = 'live'
    occurrencePhaseLabel = '进行中'
  }

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
    startText,
    endText,
    occurrenceDateKey: occ.dateKey,
    occurrenceDateParts: occ.dateParts,
    occurrenceEnded: Boolean(occ.ended),
    occurrenceStarted: Boolean(occ.started),
    occurrencePhase,
    occurrencePhaseLabel,
    isPeriodic: Boolean(occ.isPeriodic),
    nextOccurrenceText: occ.ended && occ.nextLabel ? occ.nextLabel : '',
    nextOccurrenceDateKey: occ.ended ? occ.nextDateKey : null,
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
    const ae = a.occurrenceEnded ? 1 : 0
    const be = b.occurrenceEnded ? 1 : 0
    if (ae !== be) return ae - be
    const ta = a.occurrenceDateParts
      ? timeSortKey({ time: a.startSchedule?.time })
      : timeSortKey(a.startSchedule)
    const tb = b.occurrenceDateParts
      ? timeSortKey({ time: b.startSchedule?.time })
      : timeSortKey(b.startSchedule)
    if (ta !== tb) return ta - tb
    const wa = a.occurrenceDateParts?.weekday ?? a.startSchedule?.weekday ?? 99
    const wb = b.occurrenceDateParts?.weekday ?? b.startSchedule?.weekday ?? 99
    if (wa !== wb) return wa - wb
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh')
  })
}

/**
 * 从可见活动列表拆出今日 / 本周（按本场 occurrence 日期）
 */
function splitSchedule(visibleList, now = new Date()) {
  const { today: todayParts, days } = weekDayParts(now)
  const today = []
  const weekMap = new Map()

  for (const raw of visibleList) {
    const item = decorate(raw, now)
    const occParts = item.occurrenceDateParts
    if (occParts) {
      if (sameCalendarDay(occParts, todayParts)) today.push(item)
      for (const day of days) {
        if (sameCalendarDay(occParts, day)) {
          weekMap.set(item.id, item)
          break
        }
      }
    } else if (matchesCalendarDay(raw, todayParts)) {
      today.push(item)
      for (const day of days) {
        if (matchesCalendarDay(raw, day)) {
          weekMap.set(item.id, item)
          break
        }
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
  isAnchoredStart,
  isPeriodicTemplate,
  resolveOccurrence,
  resolveOccurrenceEndMs,
  resolveRelevantStartMs,
  resolveUrgency,
  decorate,
  splitSchedule,
  formatScheduleText,
  WEEKDAY_LABELS,
  TYPE_LABELS,
  STATUS_LABELS,
}
