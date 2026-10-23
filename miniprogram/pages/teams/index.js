const { callMemberApi } = require('../../utils/api')
const { teamStatusLabel, formatStartAt } = require('../../utils/teams')

Page({
  data: {
    loading: true,
    error: '',
    activityId: '',
    teams: [],
  },

  onLoad(query) {
    this.activityId = query.activityId || ''
    this.setData({ activityId: this.activityId })
  },

  onShow() {
    this.load()
  },

  async load() {
    if (!this.activityId) {
      this.setData({ loading: false, error: '缺少活动 id' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const [list, activity] = await Promise.all([
        callMemberApi('listTeamsByActivity', { activityId: this.activityId }),
        callMemberApi('getActivity', { id: this.activityId }),
      ])
      const activityStartText = activity?.startText || '未定时间'
      const teams = (list || [])
        .map((t) => {
          const hasOwnStart = Boolean(t.startAt)
          return {
            ...t,
            statusLabel: teamStatusLabel(t.status),
            startText: hasOwnStart ? formatStartAt(t.startAt) : activityStartText,
            startIsActivity: !hasOwnStart,
            line1: `${t.leaderCharacterName || '队长'} · ${t.memberCount || 0}/${t.maxMembers}`,
            badge: t.myInTeam
              ? t.myIsLeader
                ? '我的队伍·队长'
                : '我的队伍'
              : t.myApplicationStatus === 'pending'
                ? '已申请'
                : '',
            sortKey: t.myInTeam ? 0 : 1,
          }
        })
        .sort((a, b) => {
          if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
          return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        })
      this.setData({ loading: false, teams })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        teams: [],
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后即可查看与参与组队。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
    }
  },

  goCreate() {
    wx.navigateTo({
      url: `/pages/team-create/index?activityId=${encodeURIComponent(this.activityId)}`,
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/team-detail/index?id=${encodeURIComponent(id)}`,
    })
  },
})
