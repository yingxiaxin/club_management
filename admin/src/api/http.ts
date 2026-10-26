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
    return Promise.reject(err)
  },
)

export default http
