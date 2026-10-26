import http from './http'

export type RsvpCounts = {
  going: number
  maybe: number
  decline: number
  total: number
}

export type TeamSummary = {
  recruitingCount: number
  seatsShort: number
  todayTeamCount: number
}

export type AttendanceBrief = {
  saved: boolean
  presentCount: number
  goingCountAtSave: number | null
  rateLabel: string
}

export type BoardActivity = {
  id: string
  title: string
  type?: string
  typeLabel?: string
  status: string
  statusLabel?: string
  enableTeam: boolean
  startText: string
  endText: string
  occurrenceDateKey: string | null
  occurrencePhase: string | null
  occurrencePhaseLabel: string
  occurrenceEnded: boolean
  occurrenceStarted: boolean
  isPeriodic: boolean
  rsvpCounts: RsvpCounts
  teamSummary: TeamSummary | null
  attendance?: AttendanceBrief | null
}

export type BoardMeta = {
  timezone: string
  today: {
    year: number
    month: number
    day: number
    weekday: number
    weekdayLabel: string
  }
  weekStart: { year: number; month: number; day: number }
  weekEnd: { year: number; month: number; day: number }
}

export type BoardPayload = {
  meta: BoardMeta
  activities: BoardActivity[]
}

export type RsvpPerson = {
  memberId?: string
  characterName: string
  pathway: string
  status: string
  statusLabel: string
}

export type ActivityRsvpSummary = {
  activityId: string
  title: string
  counts: RsvpCounts
  groups: {
    going: RsvpPerson[]
    maybe: RsvpPerson[]
    decline: RsvpPerson[]
  }
}

export type AttendancePerson = RsvpPerson & {
  present: boolean
}

export type AttendancePayload = {
  activityId: string
  title: string
  occurrenceDateKey: string
  occurrenceEnded: boolean
  occurrenceStarted: boolean
  canEdit: boolean
  saved: boolean
  presentMemberIds: string[]
  presentCount: number
  goingCount: number
  goingCountAtSave: number | null
  updatedAt: string | null
  people: AttendancePerson[]
  /** 无 RSVP、补录进实到的成员 */
  extras?: AttendancePerson[]
}

export type MemberStatRecent = {
  activityId: string
  title: string
  dateKey: string
  status: string
  statusLabel: string
}

export type MemberStatRow = {
  memberId: string
  characterName: string
  pathway: string
  going: number
  maybe: number
  decline: number
  /** 近窗口内已保存实到场次数（含未报名补录） */
  present: number
  total: number
  intentionRate: number | null
  recent: MemberStatRecent[]
}

export type MemberStatsPayload = {
  weeks: number
  cutoffDateKey: string
  todayDateKey: string
  members: MemberStatRow[]
}

async function unwrap<T>(p: Promise<{ data: { ok: boolean; data?: T; message?: string } }>) {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data as T
}

export function fetchTodayBoard() {
  return unwrap<BoardPayload>(http.get('/api/ops/board/today'))
}

export function fetchWeekBoard() {
  return unwrap<BoardPayload>(http.get('/api/ops/board/week'))
}

export function fetchActivityRsvps(id: string) {
  return unwrap<ActivityRsvpSummary>(http.get(`/api/activities/${id}/rsvps`))
}

export function fetchAttendance(id: string, dateKey?: string | null) {
  return unwrap<AttendancePayload>(
    http.get(`/api/activities/${id}/attendance`, {
      params: dateKey ? { dateKey } : undefined,
    }),
  )
}

export function saveAttendance(
  id: string,
  body: { presentMemberIds: string[]; dateKey?: string | null },
) {
  return unwrap<AttendancePayload>(http.put(`/api/activities/${id}/attendance`, body))
}

export function fetchMemberStats(weeks = 4) {
  return unwrap<MemberStatsPayload>(http.get('/api/ops/board/member-stats', { params: { weeks } }))
}
