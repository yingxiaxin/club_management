/**
 * 本机用小程序 AppSecret 调微信 HTTP 接口生成小程序码（绕过云函数 openapi access_token 问题）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function loadAppIdFromRepo() {
  try {
    const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../env.json')
    if (!fs.existsSync(envFile)) return ''
    const conf = JSON.parse(fs.readFileSync(envFile, 'utf8'))
    return conf.appId || ''
  } catch {
    return ''
  }
}

let cached = { token: '', expireAt: 0 }

async function getAccessToken(appId, secret) {
  const now = Date.now()
  if (cached.token && cached.expireAt > now + 60_000) return cached.token
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`
  const res = await fetch(url)
  const json = await res.json()
  if (!json.access_token) {
    throw new Error(json.errmsg || '获取 access_token 失败（检查 WECHAT_APP_SECRET）')
  }
  cached = {
    token: json.access_token,
    expireAt: now + (Number(json.expires_in) || 7200) * 1000,
  }
  return cached.token
}

export function canGenerateWxacodeLocally() {
  const appId = process.env.WECHAT_APPID || loadAppIdFromRepo()
  const secret = process.env.WECHAT_APP_SECRET || ''
  return Boolean(appId && secret)
}

/** @returns {Promise<string|null>} data:image/png;base64,... */
export async function generateUnlimitedQrBase64(ticketId) {
  const appId = process.env.WECHAT_APPID || loadAppIdFromRepo()
  const secret = process.env.WECHAT_APP_SECRET || ''
  if (!appId || !secret) return null

  const token = await getAccessToken(appId, secret)
  const envVersion = process.env.CLOUD_QR_ENV_VERSION || 'develop'
  const url = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: String(ticketId).slice(0, 32),
      page: 'pages/admin-login/index',
      check_path: false,
      env_version: envVersion,
      width: 280,
    }),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  // 失败时微信返回 JSON
  if (buf[0] === 0x7b) {
    const err = JSON.parse(buf.toString('utf8'))
    throw new Error(err.errmsg || `getwxacodeunlimit 失败 (${err.errcode})`)
  }
  return `data:image/png;base64,${buf.toString('base64')}`
}
