const { callMemberApi } = require('../../utils/api')
const { mapWithPublishedText } = require('../../utils/datetime')
const { pathwayClass, mapWithPathwayClass } = require('../../utils/pathway')

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
    todayCount: 0,
    weekCount: 0,
    identityLine: '',
    identityPathwayTint: '',
    weekHubLoading: false,
    weekHubActivities: [],
    weekHubTeamGaps: [],
    pendingApprovalCount: 0,
    weekHubEmpty: false,
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
            this.loadWeekHub(),
            this.loadAnnouncements(),
            this.loadGalleryPreview(),
          ])
        } else {
          this.loadWeekHub()
          this.loadAnnouncements()
          this.loadGalleryPreview()
        }
      } else {
        this.setData({
          todayCount: 0,
          weekCount: 0,
          announcements: [],
          galleryPreview: [],
          galleryPages: [],
          weekHubActivities: [],
          weekHubTeamGaps: [],
          pendingApprovalCount: 0,
          weekHubEmpty: false,
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
      const announcements = mapWithPublishedText(list)
      this.setData({
        announceLoading: false,
        announcements,
        announceSwiperIndex: 0,
      })
    } catch (e) {
      console.error('[loadAnnouncements]', e)
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
      const preview = mapWithPathwayClass(Array.isArray(list) ? list.slice(0, 6) : [])
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

  decorateHubActivities(list) {
    const icons = { hot: '🔥', soon: '⏰', calm: '🍃' }
    return (Array.isArray(list) ? list : []).map((item) => {
      const urgency =
        item.urgency ||
        String(item.urgencyClass || '').replace(/^urgency-/, '') ||
        ''
      const urgencyClass = item.urgencyClass || (urgency ? `urgency-${urgency}` : '')
      return {
        ...item,
        urgency,
        urgencyClass,
        urgencyIcon: icons[urgency] || '',
      }
    })
  },

  decorateHubTeamGaps(list) {
    return (Array.isArray(list) ? list : []).map((item) => {
      const pathwayCls = pathwayClass(item.leaderPathway)
      return {
        ...item,
        leaderPathwayTint: pathwayCls ? `${pathwayCls} pathway-tint` : '',
      }
    })
  },

  async loadWeekHub() {
    this.setData({ weekHubLoading: true })
    try {
      const data = await callMemberApi('weekHub')
      const activities = this.decorateHubActivities(data.activities)
      const teamGaps = this.decorateHubTeamGaps(data.teamGaps)
      const pendingApprovalCount = Number(data.pendingApprovalCount) || 0
      const weekHubEmpty = !activities.length && !teamGaps.length
      this.setData({
        weekHubLoading: false,
        weekHubActivities: activities,
        weekHubTeamGaps: teamGaps,
        pendingApprovalCount,
        weekHubEmpty,
        todayCount: Number(data.todayCount) || 0,
        weekCount: Number(data.weekCount) || 0,
      })
    } catch (e) {
      console.error('[loadWeekHub]', e)
      // 失败时回退拉日程数量，避免顶行今日/本周变成 0
      let todayCount = 0
      let weekCount = 0
      try {
        const schedule = await callMemberApi('listSchedule')
        todayCount = Array.isArray(schedule.today) ? schedule.today.length : 0
        weekCount = Array.isArray(schedule.week) ? schedule.week.length : 0
      } catch (e2) {
        console.error('[loadWeekHub] listSchedule fallback', e2)
      }
      this.setData({
        weekHubLoading: false,
        weekHubActivities: [],
        weekHubTeamGaps: [],
        pendingApprovalCount: 0,
        weekHubEmpty: true,
        todayCount,
        weekCount,
      })
      wx.showToast({
        title: (e && e.message) || '会务加载失败',
        icon: 'none',
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

  goTeamDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/team-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/index' })
  },

  goMine() {
    wx.navigateTo({ url: '/pages/mine/index' })
  },
})
