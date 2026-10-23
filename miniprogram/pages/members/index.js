const { callMemberApi } = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    list: [],
    pathwayOptions: [],
    titleOptions: [],
    q: '',
    sort: 'powerScore',
    order: 'desc',
    pathway: '',
    title: '',
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  onSearchInput(e) {
    this.setData({ q: String(e.detail.value || '') })
  },

  onSearch() {
    this.load()
  },

  onSort(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.sort) return
    this.setData({ sort }, () => this.load())
  },

  onToggleOrder() {
    this.setData(
      { order: this.data.order === 'desc' ? 'asc' : 'desc' },
      () => this.load(),
    )
  },

  onPathway(e) {
    const pathway = e.currentTarget.dataset.pathway || ''
    this.setData({ pathway }, () => this.load())
  },

  onTitle(e) {
    const title = e.currentTarget.dataset.title || ''
    this.setData({ title }, () => this.load())
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const { sort, order, pathway, title, q } = this.data
      const list = await callMemberApi('listMembers', {
        query: {
          sort,
          order,
          pathway: pathway || undefined,
          title: title || undefined,
          q: q.trim() || undefined,
        },
      })
      const rows = Array.isArray(list) ? list : []
      let pathwayOptions = this.data.pathwayOptions
      let titleOptions = this.data.titleOptions
      if (!pathway && !title && !q.trim()) {
        const pathways = new Set()
        const titles = new Set()
        rows.forEach((m) => {
          if (m.pathway) pathways.add(m.pathway)
          if (m.title) titles.add(m.title)
        })
        pathwayOptions = Array.from(pathways).sort((a, b) => a.localeCompare(b, 'zh'))
        titleOptions = Array.from(titles).sort((a, b) => a.localeCompare(b, 'zh'))
      }
      this.setData({
        loading: false,
        list: rows,
        pathwayOptions,
        titleOptions,
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
          content: '用管理员给你的邀请码关联游戏角色后，即可查看成员名单。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/join/index' })
            }
          },
        })
      }
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/member-detail/index?id=${id}` })
  },
})
