/**
 * 定时到点结算（每分钟）。
 * 触发：云函数定时器；亦可手动 callFunction({ name: 'teamLifecycle' })
 *
 * memberApi.expireTeamsDue：
 * 1) 一次性活动本场结束后 → status=ended + 关闭下属招募中队伍
 * 2) 队伍 startAt 到点 → started
 * 周期活动保持 published，仅换场清 RSVP/队伍（读路径 ensureCycleRollover）。
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
    const activitiesEnded = (result.data && result.data.activitiesEnded) || []
    if (expired.length || activitiesEnded.length) {
      console.log(
        '[teamLifecycle] teams',
        expired.length,
        'activities',
        activitiesEnded.length,
        { expired, activitiesEnded },
      )
    }
    return {
      ok: true,
      expired,
      activitiesEnded,
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
