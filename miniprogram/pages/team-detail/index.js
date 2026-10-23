const { callMemberApi } = require('../../utils/api')
const {
  teamStatusLabel,
  appStatusLabel,
  formatStartAt,
} = require('../../utils/teams')
const { mapWithPathwayClass } = require('../../utils/pathway')

Page({
  data: {
    loading: true,
    error: '',
    team: null,
    applyMessage: '',
    busy: false,
  },

  onLoad(query) {
    this.teamId = query.id || query.teamId || ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load({ soft: true }).finally(() => wx.stopPullDownRefresh())
  },

  decorate(team) {
    if (!team) return null
    const manageable =
      team.status === 'recruiting' ||
      team.status === 'full' ||
      team.status === 'paused'
    return {
      ...team,
      members: mapWithPathwayClass(team.members),
      pendingApplications: mapWithPathwayClass(team.pendingApplications),
      statusLabel: teamStatusLabel(team.status),
      startText: formatStartAt(team.startAt),
      myAppLabel: team.myApplicationStatus
        ? appStatusLabel(team.myApplicationStatus)
        : '',
      canApply:
        team.status === 'recruiting' &&
        !team.myInTeam &&
        team.myApplicationStatus !== 'pending',
      canCancelApply: team.myApplicationStatus === 'pending',
      canLeave: team.myInTeam && !team.myIsLeader && manageable,
      canManage: team.myIsLeader && manageable,
      canPauseRecruit:
        team.myIsLeader &&
        (team.status === 'recruiting' || team.status === 'full'),
      canResumeRecruit: team.myIsLeader && team.status === 'paused',
      canDissolve: team.myIsLeader && manageable,
    }
  },

  async load({ soft = false } = {}) {
    if (!this.teamId) {
      this.setData({ loading: false, error: '缺少队伍 id' })
      return
    }
    if (!soft) this.setData({ loading: true, error: '' })
    try {
      const team = await callMemberApi('getTeam', { teamId: this.teamId })
      this.setData({
        loading: false,
        team: this.decorate(team),
      })
      const nav =
        team?.leaderCharacterName || team?.modeName || '队伍详情'
      wx.setNavigationBarTitle({ title: nav })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        team: soft ? this.data.team : null,
      })
    }
  },

  onApplyMessage(e) {
    this.setData({ applyMessage: e.detail.value })
  },

  async runAction(fn, okTitle) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const team = await fn()
      if (team) {
        this.setData({
          busy: false,
          team: this.decorate(team),
          applyMessage: '',
        })
        if (okTitle) wx.showToast({ title: okTitle, icon: 'success' })
      } else {
        this.setData({ busy: false })
      }
    } catch (e) {
      this.setData({ busy: false })
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },

  onApply() {
    this.runAction(
      () =>
        callMemberApi('applyTeam', {
          teamId: this.teamId,
          message: this.data.applyMessage,
        }),
      '已提交申请',
    )
  },

  onCancelApply() {
    this.runAction(
      () => callMemberApi('cancelTeamApplication', { teamId: this.teamId }),
      '已撤回',
    )
  },

  onApprove(e) {
    const memberId = e.currentTarget.dataset.id
    if (!memberId) return
    this.runAction(
      () =>
        callMemberApi('reviewTeamApplication', {
          teamId: this.teamId,
          memberId,
          decision: 'approve',
        }),
      '已通过',
    )
  },

  onReject(e) {
    const memberId = e.currentTarget.dataset.id
    if (!memberId) return
    this.runAction(
      () =>
        callMemberApi('reviewTeamApplication', {
          teamId: this.teamId,
          memberId,
          decision: 'reject',
        }),
      '已拒绝',
    )
  },

  onKick(e) {
    const memberId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该成员'
    if (!memberId) return
    wx.showModal({
      title: '踢出队员',
      content: `确定将「${name}」踢出队伍？`,
      success: (res) => {
        if (!res.confirm) return
        this.runAction(
          () =>
            callMemberApi('kickTeamMember', {
              teamId: this.teamId,
              memberId,
            }),
          '已踢出',
        )
      },
    })
  },

  onLeave() {
    wx.showModal({
      title: '离开队伍',
      content: '确定离开当前队伍？',
      success: (res) => {
        if (!res.confirm) return
        this.runAction(
          () => callMemberApi('leaveTeam', { teamId: this.teamId }),
          '已离队',
        )
      },
    })
  },

  onTransfer(e) {
    const memberId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该队员'
    if (!memberId) return
    wx.showModal({
      title: '转让队长',
      content: `将队长转让给「${name}」？`,
      success: (res) => {
        if (!res.confirm) return
        this.runAction(
          () =>
            callMemberApi('transferTeamLeader', {
              teamId: this.teamId,
              memberId,
            }),
          '已转让',
        )
      },
    })
  },

  onPauseRecruit() {
    wx.showModal({
      title: '关闭招募',
      content: '关闭后他人不能再申请加入；可随时再次开启。待审申请将被拒绝。',
      success: (res) => {
        if (!res.confirm) return
        this.runAction(
          () =>
            callMemberApi('pauseTeamRecruiting', { teamId: this.teamId }),
          '已关闭招募',
        )
      },
    })
  },

  onResumeRecruit() {
    this.runAction(
      () => callMemberApi('resumeTeamRecruiting', { teamId: this.teamId }),
      '已开启招募',
    )
  },

  onDissolve() {
    wx.showModal({
      title: '撤销队伍',
      content: '解散后队伍将从列表中消失，且不可恢复。确定？',
      confirmColor: '#b86558',
      success: (res) => {
        if (!res.confirm) return
        this.runAction(async () => {
          await callMemberApi('dissolveTeam', { teamId: this.teamId })
          wx.showToast({ title: '已撤销', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/activities/index' }) })
          }, 400)
          return null
        })
      },
    })
  },
})
