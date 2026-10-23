/**
 * P2-d：到点自动结束招募。
 * 触发：云函数定时器每分钟；亦可手动 callFunction({ name: 'teamLifecycle' })
 *
 * 逻辑落在 memberApi.teamsDb.expireTeamsDue（recruiting/full/paused 且 startAt<=now → started，待审 rejected）。
 * 本函数只做定时入口，避免与 memberApi 业务分叉。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const startedAt = new Date().toISOString()
  try {
    const res = await cloud.callFunction({
      name: 'memberApi',
      data: { action: 'expireTeamsDue' },
    })
    const result = res.result || {}
    if (!result.ok) {
      console.error('[teamLifecycle] memberApi fail', result)
      return {
        ok: false,
        message: result.message || 'expireTeamsDue failed',
        startedAt,
      }
    }
    const expired = (result.data && result.data.expired) || []
    if (expired.length) {
      console.log('[teamLifecycle] expired', expired.length, expired)
    }
    return {
      ok: true,
      expired,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  } catch (e) {
    console.error('[teamLifecycle]', e)
    return {
      ok: false,
      message: e.message || String(e),
      startedAt,
    }
  }
}
