Page({
  goJoin() {
    wx.redirectTo({ url: '/pages/join/index' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
