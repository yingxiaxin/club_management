const { callMemberApi } = require('../../utils/api')

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
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await callMemberApi('whoami')
      const joinPending = data.joinApplication?.status === 'pending'
      this.setData({
        loading: false,
        role: data.role || 'guest',
        roleLabel: ROLE_LABELS[data.role] || data.role || '访客',
        displayName: data.displayName || data.member?.characterName || '',
        memberId: data.memberId || '',
        canViewMembers: Boolean(data.canViewMembers),
        joinPending,
        isAdmin: Boolean(data.isAdmin),
      })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败，请确认已部署云函数 memberApi',
      })
    }
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/members/index' })
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/index' })
  },

  goAdminLogin() {
    wx.navigateTo({ url: '/pages/admin-login/index' })
  },
})
