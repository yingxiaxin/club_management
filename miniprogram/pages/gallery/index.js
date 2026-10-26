const { callMemberApi } = require('../../utils/api')
const { mapWithPathwayClass } = require('../../utils/pathway')

Page({
  data: {
    loading: true,
    error: '',
    list: [],
    sort: 'likes',
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  onSort(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.sort) return
    this.setData({ sort })
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const list = await callMemberApi('listGalleryPosts', {
        limit: 50,
        sort: this.data.sort || 'likes',
      })
      this.setData({
        loading: false,
        list: mapWithPathwayClass(Array.isArray(list) ? list : []),
      })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        list: [],
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后即可浏览踏云寻芳。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/gallery-create/index' })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/gallery-detail/index?id=${encodeURIComponent(id)}`,
    })
  },
})
