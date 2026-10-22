/**
 * 调用成员端云函数 memberApi
 */
async function callMemberApi(action, data = {}) {
  const res = await wx.cloud.callFunction({
    name: 'memberApi',
    data: { action, ...data },
  })
  const result = res.result || {}
  if (!result.ok) {
    const err = new Error(result.message || '请求失败')
    err.status = result.status
    throw err
  }
  return result.data
}

module.exports = {
  callMemberApi,
}
