/**
 * 本机用小程序 AppSecret 调微信 HTTP 接口生成小程序码（绕过云函数 openapi access_token 问题）。
 * 使用 node:https，兼容 Node 16（无全局 fetch）。
 */
import fs from 'node:fs'
import https from 'node:https'
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

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string|Buffer }} [opts]
 * @returns {Promise<Buffer>}
 */
function httpsRequest(url, opts = {}) {
  const method = opts.method || 'GET'
  const headers = opts.headers || {}
  const body = opts.body
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let cached = { token: '', expireAt: 0 }

async function getAccessToken(appId, secret) {
  const now = Date.now()
  if (cached.token && cached.expireAt > now + 60_000) return cached.token
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`
  const buf = await httpsRequest(url)
  const json = JSON.parse(buf.toString('utf8'))
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
  const body = JSON.stringify({
    scene: String(ticketId).slice(0, 32),
    page: 'pages/admin-login/index',
    check_path: false,
    env_version: envVersion,
    width: 280,
  })
  const buf = await httpsRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  })
  // 失败时微信返回 JSON
  if (buf[0] === 0x7b) {
    const err = JSON.parse(buf.toString('utf8'))
    throw new Error(err.errmsg || `getwxacodeunlimit 失败 (${err.errcode})`)
  }
  // 多数为 PNG；偶发 JPEG（魔数 FF D8）
  const mime =
    buf[0] === 0xff && buf[1] === 0xd8
      ? 'image/jpeg'
      : buf[0] === 0x89 && buf[1] === 0x50
        ? 'image/png'
        : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}
