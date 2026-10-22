import http from './http'
import type { Member, MemberInput } from '@/types/member'

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; message: string }

async function unwrap<T>(p: Promise<{ data: ApiOk<T> | ApiErr }>): Promise<T> {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data
}

/** @deprecated 请用 `@/api/auth` 的 loginWithPassword；保留兼容旧引用 */
export function login(username: string, password: string) {
  return unwrap(
    http.post('/api/auth/login', { username, password }) as Promise<{
      data: ApiOk<{ token: string; role: string; displayName: string; username: string }>
    }>,
  )
}

export function fetchMe() {
  return unwrap(http.get('/api/auth/me') as Promise<{ data: ApiOk<{ username: string; role: string; displayName: string }> }>)
}

export function fetchMembers(params?: Record<string, string>) {
  return unwrap(http.get('/api/members', { params }) as Promise<{ data: ApiOk<Member[]> }>)
}

export function createMember(body: MemberInput) {
  return unwrap(http.post('/api/members', body) as Promise<{ data: ApiOk<Member> }>)
}

export function updateMember(id: string, body: Partial<MemberInput>) {
  return unwrap(http.put(`/api/members/${id}`, body) as Promise<{ data: ApiOk<Member> }>)
}

export function removeMember(id: string) {
  return unwrap(http.delete(`/api/members/${id}`) as Promise<{ data: ApiOk<Member> }>)
}

export async function exportMembersCsv() {
  const res = await http.get('/api/members/export.csv', { responseType: 'blob' })
  return res.data as Blob
}
