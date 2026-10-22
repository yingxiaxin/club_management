/**
 * 经云函数 adminApi 做扫码登录票（需 CLOUDBASE_*）。
 * 小程序码优先本机 AppSecret 生成（避免云函数 openapi access_token 无效）。
 */
import tcb from '@cloudbase/node-sdk'
import * as cloudMembers from './cloudMembers.js'
import { canGenerateWxacodeLocally, generateUnlimitedQrBase64 } from './wxacode.js'

let app = null

function getApp() {
  cloudMembers.loadEnvDefaultsFromRepo()
  if (!cloudMembers.isCloudMembersConfigured()) {
    throw Object.assign(new Error('扫码登录需要配置 CLOUDBASE_ENV / SECRET_ID / SECRET_KEY'), {
      status: 503,
    })
  }
  if (!app) {
    app = tcb.init({
      env: process.env.CLOUDBASE_ENV,
      secretId: process.env.CLOUDBASE_SECRET_ID,
      secretKey: process.env.CLOUDBASE_SECRET_KEY,
    })
  }
  return app
}

async function callAdminApi(data) {
  const res = await getApp().callFunction({ name: 'adminApi', data })
  const result = res.result
  if (!result || result.ok === false) {
    throw Object.assign(new Error(result?.message || '云函数调用失败'), {
      status: result?.status || 500,
    })
  }
  return result.data
}

export function isQrLoginConfigured() {
  cloudMembers.loadEnvDefaultsFromRepo()
  return cloudMembers.isCloudMembersConfigured()
}

/** 本机是否已配 WECHAT_APP_SECRET（可出小程序码） */
export { canGenerateWxacodeLocally }

export async function startQrLogin() {
  const data = await callAdminApi({ action: 'createAdminLoginTicket' })
  if (data?.qrBase64) return data

  // 云函数 openapi 常因 INVALID_WX_ACCESS_TOKEN 失败；本机用 AppSecret 补码
  if (canGenerateWxacodeLocally()) {
    try {
      const qrBase64 = await generateUnlimitedQrBase64(data.ticketId)
      if (qrBase64) {
        return {
          ...data,
          qrBase64,
          qrTip: null,
        }
      }
    } catch (e) {
      return {
        ...data,
        qrTip: e.message || data.qrTip || '本机生成小程序码失败',
      }
    }
  }

  return {
    ...data,
    qrTip:
      data.qrTip ||
      '云端小程序码不可用。请在小程序「管理端扫码登录」页输入下方票号并确认；或在 .env 配置 WECHAT_APP_SECRET 以本机出码。',
  }
}

export async function pollQrLogin(ticketId) {
  return callAdminApi({ action: 'getAdminLoginTicket', ticketId })
}

export async function consumeQrLogin(ticketId) {
  return callAdminApi({ action: 'consumeAdminLoginTicket', ticketId })
}
