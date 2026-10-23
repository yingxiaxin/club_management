const { callMemberApi } = require('../../utils/api')
const { mapWithPublishedText } = require('../../utils/datetime')

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
    scheduleLoading: false,
    todayPreview: [],
    todayCount: 0,
    weekCount: 0,
    identityLine: '',
    showAdminTools: false,
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
      })
      if (canViewMembers) {
        if (awaitExtras) {
          await Promise.all([this.loadSchedulePreview(), this.loadAnnouncements()])
        } else {
          this.loadSchedulePreview()
          this.loadAnnouncements()
        }
      } else {
        this.setData({
          todayPreview: [],
          todayCount: 0,
          weekCount: 0,
          announcements: [],
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

  onMeHeadTap() {
    if (!this.data.isAdmin) return
    this.setData({ showAdminTools: !this.data.showAdminTools })
  },

  goMembers() {
    wx.switchTab({ url: '/pages/members/index' })
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

  goAdminLogin() {
    wx.navigateTo({ url: '/pages/admin-login/index' })
  },
})
