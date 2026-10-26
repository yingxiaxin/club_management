import http from './http'

export type ActivityType = 'daily' | 'weekly' | 'pvp' | 'custom'
export type ActivityStatus = 'draft' | 'published' | 'ongoing' | 'ended' | 'cancelled'
export type ReminderCycle = 'none' | 'once' | 'daily' | 'weekly' | 'monthly'

/** 日程分量：年月日 / 时间 / 星期（1=周一…7=周日）均可选填 */
export interface ScheduleParts {
  year: number | null
  month: number | null
  day: number | null
  weekday: number | null
  time: string | null
}

export interface Activity {
  id: string
  title: string
  type: ActivityType
  startSchedule?: ScheduleParts | null
  endSchedule?: ScheduleParts | null
  startAt: string | null
  endAt: string | null
  description: string
  enableTeam: boolean
  reminderCycle?: ReminderCycle
  reminderOffsetsMinutes: number[]
  status: ActivityStatus
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

export interface ActivityCreateBody {
  title?: string
  type?: ActivityType
  startSchedule: ScheduleParts
  endSchedule?: ScheduleParts | null
  description?: string
  enableTeam?: boolean
  reminderCycle?: ReminderCycle
  reminderOffsetsMinutes?: number[]
  status?: 'draft' | 'published'
}

async function unwrap<T>(p: Promise<{ data: { ok: boolean; data?: T; message?: string } }>) {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data as T
}

export function fetchActivities(params?: { status?: string; q?: string }) {
  return unwrap<Activity[]>(http.get('/api/activities', { params }))
}

export function createActivity(body: ActivityCreateBody) {
  return unwrap<Activity>(http.post('/api/activities', body))
}

export function updateActivity(id: string, body: Partial<ActivityCreateBody>) {
  return unwrap<Activity>(http.put(`/api/activities/${id}`, body))
}

export function transitionActivity(id: string, action: 'publish' | 'cancel' | 'start' | 'end') {
  return unwrap<Activity>(http.post(`/api/activities/${id}/transition`, { action }))
}

export type RsvpOccurrenceOption = {
  dateKey: string
  label: string
  source: 'live' | 'snapshot'
  rowCount: number
}

export function fetchActivityRsvpOccurrences(id: string) {
  return unwrap<{ options: RsvpOccurrenceOption[] }>(
    http.get(`/api/activities/${id}/rsvps/occurrences`),
  )
}

/** RSVP CSV；dateKey=live 本场，或 YYYY-MM-DD 快照 */
export async function exportActivityRsvpsCsv(id: string, dateKey = 'live') {
  try {
    const res = await http.get(`/api/activities/${id}/rsvps/export.csv`, {
      params: { dateKey },
      responseType: 'blob',
    })
    return res.data as Blob
  } catch (e) {
    const err = e as { response?: { data?: Blob }; message?: string }
    const data = err.response?.data
    if (data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text()) as { message?: string }
        if (parsed.message) throw new Error(parsed.message)
      } catch (inner) {
        if (inner instanceof Error && inner.message !== 'Unexpected end of JSON input') throw inner
      }
    }
    throw e instanceof Error ? e : new Error(err.message || '导出失败')
  }
}
