import axios from 'axios'
import { getToken, clearAuth } from '@/auth/session'

const http = axios.create({
  baseURL: '/',
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearAuth()
      if (location.pathname !== '/login') {
        location.href = '/login'
      }
    }
    const serverMsg =
      err.response?.data &&
      typeof err.response.data === 'object' &&
      typeof (err.response.data as { message?: unknown }).message === 'string'
        ? (err.response.data as { message: string }).message.trim()
        : ''
    if (serverMsg) {
      return Promise.reject(new Error(serverMsg))
    }
    // axios 超时 / 主动 abort 时，Chrome Network 常显示 canceled
    const code = String(err.code || '')
    const raw = String(err.message || '')
    if (
      code === 'ECONNABORTED' ||
      code === 'ERR_CANCELED' ||
      /timeout/i.test(raw) ||
      /^canceled$/i.test(raw)
    ) {
      return Promise.reject(
        new Error('请求超时或连接被中断（OCR/导入可能较慢）。请少图重试；公网请确认反代超时 ≥180s'),
      )
    }
    return Promise.reject(err)
  },
)

export default http
