// 成员端骨架：P0-d 再补登录与业务页。云函数部署依赖本工程能正常打开。
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用支持云开发的基础库')
      return
    }
    wx.cloud.init({
      env: 'cloud1-d6gjqx2kd2f3765f4',
      traceUser: true,
    })
  },
})
