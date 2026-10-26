const { callMemberApi } = require('../../utils/api')
const { pathwayClass } = require('../../utils/pathway')
const { teamStatusLabel, formatStartAt } = require('../../utils/teams')

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
    member: null,
    canViewMembers: false,
    joinPending: false,
    isAdmin: false,
    pathwayTint: '',
    pendingApprovalCount: 0,
    pendingTeams: [],
    rsvpsActive: [],
    rsvpsEnded: [],
    teams: [],
    reminders: [],
    unbinding: false,
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
      const data = await callMemberApi('myDesk')
      const member = data.member || null
      const joinPending = data.joinApplication?.status === 'pending'
      const pathwayCls = member ? pathwayClass(member.pathway) : ''
      const teams = (data.teams || []).map((t) => ({
        ...t,
        statusLabel: t.statusLabel || teamStatusLabel(t.status),
        startText: t.startAt ? formatStartAt(t.startAt) : '',
        line1: `${t.activityTitle || '活动'} · ${t.modeName || '组队'}`,
        line2: `${t.myIsLeader ? '队长' : '队员'} · ${t.memberCount || 0}/${t.maxMembers || 0}${
          t.startAt ? ` · ${formatStartAt(t.startAt)}` : ''
        }`,
      }))
      this.setData({
        loading: false,
        role: data.role || 'guest',
        roleLabel: ROLE_LABELS[data.role] || data.role || '访客',
        displayName: data.displayName || member?.characterName || '',
        memberId: data.memberId || '',
        member,
        canViewMembers: Boolean(data.canViewMembers),
        joinPending,
        isAdmin: Boolean(data.isAdmin),
        pathwayTint: pathwayCls ? `${pathwayCls} pathway-tint` : '',
        pendingApprovalCount: data.pendingApprovalCount || 0,
        pendingTeams: data.pendingTeams || [],
        rsvpsActive: data.rsvpsActive || [],
        rsvpsEnded: data.rsvpsEnded || [],
        teams,
        reminders: data.reminders || [],
      })
    } catch (e) {
      const raw = e.message || ''
      const soft =
        /memberApi|云函数|deploy|网络|timeout|fail/i.test(raw) || !raw
          ? '暂时无法连接俱乐部服务，请稍后重试'
          : raw
      this.setData({ loading: false, error: soft })
    }
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/index' })
  },

  goProfile() {
    const id = this.data.memberId
    if (!id) return
    wx.navigateTo({
      url: `/pages/member-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  goActivity(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/activity-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  goTeam(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/team-detail/index?id=${encodeURIComponent(id)}`,
    })
  },

  goAdminLogin() {
    wx.navigateTo({ url: '/pages/admin-login/index' })
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
