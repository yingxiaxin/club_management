const { callMemberApi } = require('../../utils/api')
const { mapWithPublishedText } = require('../../utils/datetime')

Page({
  data: {
    loading: true,
    error: '',
    list: [],
    expandedId: '',
  },

  onLoad(query) {
    this.focusId = query.id ? String(query.id) : ''
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
      const list = mapWithPublishedText(
        await callMemberApi('listAnnouncements', { limit: 50 }),
      )
      const focusId = this.focusId || ''
      const hit = focusId && list.some((a) => String(a.id) === focusId)
      this.setData({
        loading: false,
        list,
        expandedId: hit ? focusId : '',
      })
      if (hit) {
        // 只自动展开一次（避免从详情返回反复强制展开）
        this.focusId = ''
        setTimeout(() => {
          wx.pageScrollTo({
            selector: `#ann-${focusId}`,
            duration: 280,
          })
        }, 80)
      }
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        list: [],
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后即可查看公告。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
    }
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({
      expandedId: this.data.expandedId === id ? '' : id,
    })
  },
})
