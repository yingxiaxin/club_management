import http from './http'

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; message: string }

async function unwrap<T>(p: Promise<{ data: ApiOk<T> | ApiErr }>): Promise<T> {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data
}

export type InviteCode = {
  id: string
  code: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  enabled: boolean
  createdBy?: string
  createdAt?: string
}

export type JoinApplication = {
  id: string
  inviteCode: string
  openid: string
  characterName: string
  memberId?: string
  pathway?: string
  remark?: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string | null
  reviewedAt?: string | null
  createdAt?: string
}

export function fetchInviteCodes() {
  return unwrap(http.get('/api/invites') as Promise<{ data: ApiOk<InviteCode[]> }>)
}

export function createInviteCode(body: {
  code?: string
  maxUses?: number
  expiresAt?: string | null
  enabled?: boolean
}) {
  return unwrap(http.post('/api/invites', body) as Promise<{ data: ApiOk<InviteCode> }>)
}

export function updateInviteCode(
  id: string,
  body: Partial<{ enabled: boolean; maxUses: number; expiresAt: string | null }>,
) {
  return unwrap(http.patch(`/api/invites/${id}`, body) as Promise<{ data: ApiOk<InviteCode> }>)
}

export function fetchJoinApplications(status?: string) {
  return unwrap(
    http.get('/api/join-applications', { params: status ? { status } : {} }) as Promise<{
      data: ApiOk<JoinApplication[]>
    }>,
  )
}

export function reviewJoinApplication(id: string, decision: 'approved' | 'rejected') {
  return unwrap(
    http.post(`/api/join-applications/${id}/review`, { decision }) as Promise<{
      data: ApiOk<JoinApplication>
    }>,
  )
}
