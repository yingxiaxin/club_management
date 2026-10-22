import http from './http'

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; message: string }

async function unwrap<T>(p: Promise<{ data: ApiOk<T> | ApiErr }>): Promise<T> {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data
}

export type QrStart = {
  ticketId: string
  expiresAt: string
  expireSeconds: number
  qrBase64: string | null
  qrTip: string | null
}

export type QrPoll =
  | { status: 'pending' | 'expired' | 'consumed'; expiresAt?: string; ticketId?: string }
  | {
      status: 'confirmed'
      token: string
      role: string
      displayName: string
      username: string
    }

export function loginWithPassword(username: string, password: string) {
  return unwrap(
    http.post('/api/auth/login', { username, password }) as Promise<{
      data: ApiOk<{ token: string; role: string; displayName: string; username: string }>
    }>,
  )
}

export function startQrLogin() {
  return unwrap(http.post('/api/auth/qr/start') as Promise<{ data: ApiOk<QrStart> }>)
}

export function pollQrLogin(ticketId: string) {
  return unwrap(http.get(`/api/auth/qr/${encodeURIComponent(ticketId)}`) as Promise<{ data: ApiOk<QrPoll> }>)
}
