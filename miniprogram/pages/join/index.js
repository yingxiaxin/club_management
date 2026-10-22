const { callMemberApi } = require('../../utils/api')

Page({
  data: {
    loading: true,
    submitting: false,
    unbinding: false,
    alreadyBound: false,
    isAdmin: false,
    boundName: '',
    application: null,
    inviteCode: '',
    characterName: '',
    remark: '',
    message: '',
  },

  onShow() {
    this.refresh()
  },

  onInviteInput(e) {
    this.setData({ inviteCode: String(e.detail.value || '').trim() })
  },
  onNameInput(e) {
    this.setData({ characterName: String(e.detail.value || '').trim() })
  },
  onRemarkInput(e) {
    this.setData({ remark: String(e.detail.value || '').trim() })
  },

  async refresh() {
    this.setData({ loading: true, message: '' })
    try {
      const data = await callMemberApi('whoami')
      let application = data.joinApplication || null
      if (!application && !data.memberId) {
        application = await callMemberApi('getMyJoinApplication')
      }
      this.setData({
        loading: false,
        alreadyBound: Boolean(data.memberId),
        isAdmin: Boolean(data.isAdmin),
        boundName: data.member?.characterName || data.displayName || '',
        application,
        characterName:
          this.data.characterName ||
          (application && application.status === 'rejected' ? application.characterName : '') ||
          '',
      })
    } catch (e) {
      this.setData({
        loading: false,
        message: e.message || '加载失败，请确认已重新部署 memberApi',
      })
    }
  },

  async onUnbindForTest() {
    if (this.data.unbinding) return
    this.setData({ unbinding: true, message: '' })
    try {
      await callMemberApi('unbindSelfForTest')
      wx.showToast({ title: '已解除关联', icon: 'success' })
      await this.refresh()
    } catch (e) {
      this.setData({ message: e.message || '解除失败' })
      wx.showToast({ title: '失败', icon: 'none' })
    } finally {
      this.setData({ unbinding: false })
    }
  },

  async onSubmit() {
    const { inviteCode, characterName, remark, submitting } = this.data
    if (submitting) return
    if (!inviteCode || !characterName) {
      wx.showToast({ title: '请填写邀请码与角色名', icon: 'none' })
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      const data = await callMemberApi('submitJoinApplication', {
        inviteCode,
        characterName,
        remark,
      })
      this.setData({
        application: data.application,
        message: '已提交，等待管理员确认关联',
      })
      wx.showToast({ title: '已提交', icon: 'success' })
    } catch (e) {
      this.setData({ message: e.message || '提交失败' })
      wx.showToast({ title: '失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goMembers() {
    wx.switchTab({ url: '/pages/members/index' })
  },
})
