const { callMemberApi } = require('../../utils/api')
const { shanghaiToIso } = require('../../utils/teams')

Page({
  data: {
    activityId: '',
    leaderName: '',
    activityStartText: '',
    maxMembers: '6',
    minPowerScore: '',
    remark: '',
    useCustomStart: false,
    startDate: '',
    startTime: '20:00',
    submitting: false,
    loading: true,
  },

  onLoad(query) {
    this.activityId = query.activityId || ''
    this.setData({ activityId: this.activityId })
    if (!this.activityId) {
      wx.showToast({ title: '缺少活动', icon: 'none' })
      this.setData({ loading: false })
      return
    }
    this.bootstrap()
  },

  onPullDownRefresh() {
    if (!this.activityId) {
      wx.stopPullDownRefresh()
      return
    }
    this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    this.setData({ loading: true })
    try {
      const [me, activity] = await Promise.all([
        callMemberApi('whoami'),
        callMemberApi('getActivity', { id: this.activityId }),
      ])
      const leaderName = me?.member?.characterName || me?.displayName || ''
      if (!me?.memberId || !leaderName) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后才能创建队伍。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
      this.setData({
        loading: false,
        leaderName,
        activityStartText: activity?.startText || '未定（活动无绝对开始时刻）',
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onMaxInput(e) {
    this.setData({ maxMembers: e.detail.value })
  },
  onScoreInput(e) {
    this.setData({ minPowerScore: e.detail.value })
  },
  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },
  onToggleStart(e) {
    this.setData({ useCustomStart: Boolean(e.detail.value) })
  },
  onDateChange(e) {
    this.setData({ startDate: e.detail.value })
  },
  onTimeChange(e) {
    this.setData({ startTime: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting || !this.activityId) return
    if (!this.data.leaderName) {
      wx.showToast({ title: '未绑定角色，无法建队', icon: 'none' })
      return
    }
    const maxMembers = Math.round(Number(this.data.maxMembers))
    if (!Number.isFinite(maxMembers) || maxMembers < 2) {
      wx.showToast({ title: '人数上限至少为 2', icon: 'none' })
      return
    }

    const payload = {
      activityId: this.activityId,
      // 后端缺省也会用队长名；显式传入保持一致
      modeName: this.data.leaderName,
      maxMembers,
      remark: String(this.data.remark || '').trim(),
    }

    const scoreRaw = String(this.data.minPowerScore || '').trim()
    if (scoreRaw) {
      const n = Number(scoreRaw)
      if (!Number.isFinite(n) || n < 0) {
        wx.showToast({ title: '要求评分无效', icon: 'none' })
        return
      }
      payload.minPowerScore = Math.round(n)
    }

    if (this.data.useCustomStart) {
      if (!this.data.startDate) {
        wx.showToast({ title: '请选择开打日期', icon: 'none' })
        return
      }
      payload.startAt = shanghaiToIso(this.data.startDate, this.data.startTime)
    }

    this.setData({ submitting: true })
    try {
      const team = await callMemberApi('createTeam', payload)
      wx.showToast({ title: '已创建', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/team-detail/index?id=${encodeURIComponent(team.id)}`,
        })
      }, 400)
    } catch (e) {
      this.setData({ submitting: false })
      wx.showToast({ title: e.message || '创建失败', icon: 'none' })
    }
  },
})
