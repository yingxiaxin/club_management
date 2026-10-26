const { callMemberApi } = require('../../utils/api')
const { mapWithPublishedText } = require('../../utils/datetime')
const { pathwayClass } = require('../../utils/pathway')

const ROLE_LABELS = {
  guest: '访客',
  member: '成员',
  admin: '管理员',
  super_admin: '超管',
}

Page({
  data: {
    loading: true,
    error: '',
    role: 'guest',
    roleLabel: '访客',
    displayName: '',
    memberId: '',
    canViewMembers: false,
    joinPending: false,
    isAdmin: false,
    clubName: '诡秘之主',
    clubIconUrl: '',
    clubIntro: '',
    announcements: [],
    announceLoading: false,
    announceSwiperIndex: 0,
    galleryPreview: [],
    galleryPages: [],
    galleryLoading: false,
    scheduleLoading: false,
    todayPreview: [],
    todayCount: 0,
    weekCount: 0,
    identityLine: '',
    identityPathwayTint: '',
    unbinding: false,
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh({ awaitExtras: true }).finally(() => wx.stopPullDownRefresh())
  },

  async refresh({ awaitExtras = false } = {}) {
    this.setData({ loading: true, error: '' })
    try {
      const [data, club] = await Promise.all([
        callMemberApi('whoami'),
        callMemberApi('getClubProfile').catch(() => null),
      ])
      const joinPending = data.joinApplication?.status === 'pending'
      const canViewMembers = Boolean(data.canViewMembers)
      const displayName = data.displayName || data.member?.characterName || ''
      let identityLine = '尚未关联游戏角色'
      if (displayName) identityLine = displayName
      else if (joinPending) identityLine = '关联申请审核中'
      const pathwayCls =
        data.memberId && data.member
          ? pathwayClass(data.member.pathway)
          : ''
      this.setData({
        loading: false,
        role: data.role || 'guest',
        roleLabel: ROLE_LABELS[data.role] || data.role || '访客',
        displayName,
        memberId: data.memberId || '',
        canViewMembers,
        joinPending,
        isAdmin: Boolean(data.isAdmin),
        clubName: (club && club.name) || '诡秘之主',
        clubIconUrl: (club && club.iconUrl) || '',
        clubIntro: (club && club.intro) || '',
        identityLine,
        identityPathwayTint: pathwayCls ? `${pathwayCls} pathway-tint` : '',
      })
      if (canViewMembers) {
        if (awaitExtras) {
          await Promise.all([
            this.loadSchedulePreview(),
            this.loadAnnouncements(),
            this.loadGalleryPreview(),
          ])
        } else {
          this.loadSchedulePreview()
          this.loadAnnouncements()
          this.loadGalleryPreview()
        }
      } else {
        this.setData({
          todayPreview: [],
          todayCount: 0,
          weekCount: 0,
          announcements: [],
          galleryPreview: [],
          galleryPages: [],
        })
      }
    } catch (e) {
      const raw = e.message || ''
      const soft =
        /memberApi|云函数|deploy|网络|timeout|fail/i.test(raw) || !raw
          ? '暂时无法连接俱乐部服务，请稍后重试'
          : raw
      this.setData({
        loading: false,
        error: soft,
      })
    }
  },

  async loadAnnouncements() {
    this.setData({ announceLoading: true })
    try {
      const list = await callMemberApi('listAnnouncements', { limit: 8 })
      this.setData({
        announceLoading: false,
        announcements: mapWithPublishedText(list),
        announceSwiperIndex: 0,
      })
    } catch {
      this.setData({ announceLoading: false, announcements: [] })
    }
  },

  onAnnounceSwiperChange(e) {
    const idx = e.detail && typeof e.detail.current === 'number' ? e.detail.current : 0
    this.setData({ announceSwiperIndex: idx })
  },

  goAnnouncements() {
    wx.navigateTo({ url: '/pages/announcements/index' })
  },

  chunkGalleryPages(list) {
    const pages = []
    const src = Array.isArray(list) ? list : []
    for (let i = 0; i < src.length; i += 2) {
      pages.push({
        key: `gp-${i}`,
        items: src.slice(i, i + 2),
      })
    }
    return pages
  },

  async loadGalleryPreview() {
    this.setData({ galleryLoading: true })
    try {
      const list = await callMemberApi('listGalleryPosts', { limit: 8, sort: 'likes' })
      const preview = Array.isArray(list) ? list.slice(0, 6) : []
      this.setData({
        galleryLoading: false,
        galleryPreview: preview,
        galleryPages: this.chunkGalleryPages(preview),
      })
    } catch {
      this.setData({
        galleryLoading: false,
        galleryPreview: [],
        galleryPages: [],
      })
    }
  },

  goGallery() {
    wx.navigateTo({ url: '/pages/gallery/index' })
  },

  goGalleryDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/gallery-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  goAnnounceDetail(e) {
    const id = e.currentTarget.dataset.id
    const q = id ? `?id=${encodeURIComponent(id)}` : ''
    wx.navigateTo({ url: `/pages/announcements/index${q}` })
  },

  async loadSchedulePreview() {
    this.setData({ scheduleLoading: true })
    try {
      const data = await callMemberApi('listSchedule')
      const today = Array.isArray(data.today) ? data.today : []
      const week = Array.isArray(data.week) ? data.week : []
      this.setData({
        scheduleLoading: false,
        todayPreview: today.slice(0, 3),
        todayCount: today.length,
        weekCount: week.length,
      })
    } catch {
      this.setData({
        scheduleLoading: false,
        todayPreview: [],
        todayCount: 0,
        weekCount: 0,
      })
    }
  },

  goActivities() {
    wx.switchTab({ url: '/pages/activities/index' })
  },

  goActivityDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/activity-detail/index?id=${id}` })
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/index' })
  },

  onUnbindTap() {
    if (!this.data.isAdmin || !this.data.memberId || this.data.unbinding) return
    wx.showModal({
      title: '解除微信关联',
      content: '解除后可用邀请码重新关联。确定继续？',
      confirmText: '解除',
      success: (res) => {
        if (res.confirm) this.doUnbind()
      },
    })
  },

  async doUnbind() {
    if (this.data.unbinding) return
    this.setData({ unbinding: true })
    try {
      await callMemberApi('unbindSelfForTest')
      wx.showToast({ title: '已解除关联', icon: 'success' })
      wx.navigateTo({ url: '/pages/join/index' })
    } catch (e) {
      wx.showToast({ title: e.message || '解除失败', icon: 'none' })
    } finally {
      this.setData({ unbinding: false })
    }
  },
})
