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
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await callMemberApi('whoami')
      this.setData({
        loading: false,
        role: data.role || 'guest',
        roleLabel: ROLE_LABELS[data.role] || data.role || '访客',
        displayName: data.displayName || data.member?.characterName || '',
        memberId: data.memberId || '',
        canViewMembers: Boolean(data.canViewMembers),
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

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' })
  },

  goAdminLogin() {
    wx.navigateTo({ url: '/pages/admin-login/index' })
  },
})
