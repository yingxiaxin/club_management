const { callMemberApi } = require('../../utils/api')
const { mapWithPathwayClass } = require('../../utils/pathway')

const RSVP_OPTIONS = [
  { status: 'going', label: '参加' },
  { status: 'maybe', label: '待定' },
  { status: 'decline', label: '请假' },
]

Page({
  data: {
    loading: true,
    error: '',
    activity: null,
    rsvpOptions: RSVP_OPTIONS,
    submitting: false,
    reminding: false,
    expanded: { going: true, maybe: false, decline: false },
  },

  onLoad(query) {
    this.activityId = query.id || ''
    this.load()
  },

  onShow() {
    if (this.activityId && this.data.activity) {
      this.load({ soft: true })
    }
  },

  async load({ soft = false } = {}) {
    if (!this.activityId) {
      this.setData({ loading: false, error: '缺少活动 id' })
      return
    }
    if (!soft) this.setData({ loading: true, error: '' })
    try {
      const activity = await callMemberApi('getActivity', { id: this.activityId })
      this.setData({
        loading: false,
        activity: this.withReminderText(activity),
      })
      if (activity?.title) {
        wx.setNavigationBarTitle({ title: activity.title })
      }
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        activity: soft ? this.data.activity : null,
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '用管理员给你的邀请码关联游戏角色后，即可查看活动。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/join/index' })
            }
          },
        })
      }
    }
  },

  withReminderText(activity) {
    if (!activity) return activity
    const offsets = activity.reminderEffectiveOffsets || []
    const rawGroups = activity.rsvpGroups || {}
    const rsvpGroups = {
      going: mapWithPathwayClass(rawGroups.going),
      maybe: mapWithPathwayClass(rawGroups.maybe),
      decline: mapWithPathwayClass(rawGroups.decline),
    }
    return {
      ...activity,
      rsvpGroups,
      reminderOffsetsText: offsets.length ? offsets.join(' / ') : '',
    }
  },

  toggleGroup(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const expanded = { ...this.data.expanded }
    expanded[key] = !expanded[key]
    this.setData({ expanded })
  },

  async onRemindMe() {
    const activity = this.data.activity
    if (!activity || this.data.reminding || activity.myReminderSubscribed) return
    if (!activity.reminderCycle || activity.reminderCycle === 'none') {
      wx.showToast({ title: '本活动未配置提醒', icon: 'none' })
      return
    }
    if (!activity.canSubscribeReminder) {
      wx.showToast({ title: '当前无法订阅提醒', icon: 'none' })
      return
    }

    this.setData({ reminding: true })
    try {
      const tmplId = activity.subscribeTemplateId
      if (tmplId) {
        const subRes = await new Promise((resolve) => {
          wx.requestSubscribeMessage({
            tmplIds: [tmplId],
            success: resolve,
            fail: resolve,
          })
        })
        const result = subRes?.[tmplId]
        if (result === 'reject') {
          this.setData({ reminding: false })
          wx.showToast({ title: '你已拒绝订阅', icon: 'none' })
          return
        }
        if (result === 'ban') {
          this.setData({ reminding: false })
          wx.showToast({ title: '订阅能力被禁用', icon: 'none' })
          return
        }
      }

      const next = await callMemberApi('subscribeActivityReminder', {
        id: this.activityId,
        accepted: true,
      })
      this.setData({ activity: this.withReminderText(next), reminding: false })
      wx.showToast({
        title: tmplId ? '已开启提醒' : '已登记提醒（待配置模板）',
        icon: 'success',
      })
    } catch (err) {
      this.setData({ reminding: false })
      wx.showToast({ title: err.message || '订阅失败', icon: 'none' })
      if (err.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '用管理员给你的邀请码关联游戏角色后，即可订阅提醒。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/join/index' })
            }
          },
        })
      }
    }
  },

  goTeams() {
    if (!this.activityId) return
    wx.navigateTo({
      url: `/pages/teams/index?activityId=${encodeURIComponent(this.activityId)}`,
    })
  },

  goCreateTeam() {
    if (!this.activityId) return
    wx.navigateTo({
      url: `/pages/team-create/index?activityId=${encodeURIComponent(this.activityId)}`,
    })
  },

  async onRsvp(e) {
    const status = e.currentTarget.dataset.status
    const activity = this.data.activity
    if (!status || !activity || this.data.submitting) return
    if (!activity.canChangeRsvp) {
      wx.showToast({
        title: activity.rsvpLockedReason || '无法修改',
        icon: 'none',
      })
      return
    }
    if (activity.myRsvp === status) return

    this.setData({ submitting: true })
    try {
      const next = await callMemberApi('setRsvp', {
        id: this.activityId,
        status,
      })
      this.setData({ activity: this.withReminderText(next), submitting: false })
      const label = RSVP_OPTIONS.find((o) => o.status === status)?.label || '已更新'
      wx.showToast({ title: `已表态：${label}`, icon: 'success' })
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
      if (err.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '用管理员给你的邀请码关联游戏角色后，即可表态出席。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/join/index' })
            }
          },
        })
      }
    }
  },
})
