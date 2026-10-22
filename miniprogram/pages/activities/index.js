const { callMemberApi } = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    today: [],
    week: [],
    todayLabel: '',
    weekRange: '',
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await callMemberApi('listSchedule')
      const meta = data.meta || {}
      const t = meta.today || {}
      const ws = meta.weekStart || {}
      const we = meta.weekEnd || {}
      const todayLabel = t.month
        ? `${t.month}月${t.day}日 ${t.weekdayLabel || ''}`.trim()
        : ''
      const weekRange =
        ws.month && we.month
          ? `${ws.month}/${ws.day} – ${we.month}/${we.day}`
          : ''
      this.setData({
        loading: false,
        today: Array.isArray(data.today) ? data.today : [],
        week: Array.isArray(data.week) ? data.week : [],
        todayLabel,
        weekRange,
      })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        today: [],
        week: [],
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要绑定',
          content: '请先绑定俱乐部角色后再查看活动',
          confirmText: '去绑定',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/bind/index' })
            }
          },
        })
      }
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/activity-detail/index?id=${id}` })
  },
})
