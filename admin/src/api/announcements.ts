import http from './http'

export interface Announcement {
  id: string
  title: string
  content: string
  pinned: boolean
  publishedAt?: string | null
  createdBy?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface AnnouncementBody {
  title: string
  content: string
  pinned?: boolean
  publishedAt?: string | null
}

async function unwrap<T>(p: Promise<{ data: { ok: boolean; data?: T; message?: string } }>) {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data as T
}

export function fetchAnnouncements() {
  return unwrap<Announcement[]>(http.get('/api/announcements'))
}

export function createAnnouncement(body: AnnouncementBody) {
  return unwrap<Announcement>(http.post('/api/announcements', body))
}

export function updateAnnouncement(id: string, body: Partial<AnnouncementBody>) {
  return unwrap<Announcement>(http.put(`/api/announcements/${id}`, body))
}

export function deleteAnnouncement(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(http.delete(`/api/announcements/${id}`))
}
