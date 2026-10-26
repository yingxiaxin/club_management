const { callMemberApi } = require('../../utils/api')
const {
  teamStatusLabel,
  formatStartAt,
  shanghaiYmd,
  matchTeamTimeFilter,
  matchTeamMineFilter,
} = require('../../utils/teams')

Page({
  data: {
    loading: true,
    error: '',
    activityId: '',
    /** 全量（本活动） */
    allTeams: [],
    /** 筛选后展示 */
    teams: [],
    timeFilter: '',
    mineFilter: '',
    /** 活动本场日期 YYYY-MM-DD；队伍无 startAt 时时间筛用此兜底 */
    activityDateKey: '',
  },

  onLoad(query) {
    this.activityId = query.activityId || ''
    this.setData({ activityId: this.activityId })
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  applyFilters() {
    const { allTeams, timeFilter, mineFilter, activityDateKey } = this.data
    const teams = (allTeams || []).filter(
      (t) =>
        matchTeamTimeFilter(t.startAt, timeFilter, activityDateKey) &&
        matchTeamMineFilter(t, mineFilter),
    )
    this.setData({ teams })
  },

  onTimeFilter(e) {
    const key = e.currentTarget.dataset.key || ''
    const next = this.data.timeFilter === key ? '' : key
    this.setData({ timeFilter: next }, () => this.applyFilters())
  },

  onMineFilter(e) {
    const key = e.currentTarget.dataset.key || ''
    const next = this.data.mineFilter === key ? '' : key
    this.setData({ mineFilter: next }, () => this.applyFilters())
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
      const activityDateKey =
        activity?.occurrenceDateKey ||
        (activity?.startAt ? shanghaiYmd(new Date(activity.startAt)) : '')
      const allTeams = (list || [])
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
      this.setData({ loading: false, allTeams, activityDateKey }, () => this.applyFilters())
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        allTeams: [],
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
