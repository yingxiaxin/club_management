const { callMemberApi } = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    post: null,
    canDelete: false,
    deleting: false,
  },

  postId: '',

  onLoad(query) {
    this.postId = query.id ? decodeURIComponent(String(query.id)) : ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    if (!this.postId) {
      this.setData({ loading: false, error: '缺少作品 id' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const [post, me] = await Promise.all([
        callMemberApi('getGalleryPost', { id: this.postId }),
        callMemberApi('whoami').catch(() => null),
      ])
      const canDelete = Boolean(
        me &&
          (me.isAdmin || (me.memberId && post.memberId === me.memberId)),
      )
      this.setData({ loading: false, post, canDelete })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        post: null,
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后即可查看。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
    }
  },

  onDelete() {
    if (this.data.deleting || !this.postId) return
    wx.showModal({
      title: '删除作品',
      content: '删除后不可恢复。确定继续？',
      confirmText: '删除',
      success: (res) => {
        if (res.confirm) this.doDelete()
      },
    })
  },

  async doDelete() {
    this.setData({ deleting: true })
    try {
      await callMemberApi('deleteGalleryPost', { id: this.postId })
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/gallery/index' }) })
      }, 400)
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    } finally {
      this.setData({ deleting: false })
    }
  },
})
