const { callMemberApi } = require('../../utils/api')

Page({
  data: {
    characterName: '',
    loading: false,
    message: '',
  },

  onInput(e) {
    this.setData({ characterName: String(e.detail.value || '').trim() })
  },

  async onSubmit() {
    const { characterName, loading } = this.data
    if (loading || !characterName) return
    this.setData({ loading: true, message: '' })
    try {
      const data = await callMemberApi('bindByCharacterName', { characterName })
      const name = data.member?.characterName || characterName
      this.setData({
        message: data.alreadyBound ? `已绑定：${name}` : `绑定成功：${name}`,
      })
      wx.showToast({ title: '绑定成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.redirectTo({ url: '/pages/members/index' }),
        })
      }, 500)
    } catch (e) {
      this.setData({ message: e.message || '绑定失败' })
      wx.showToast({ title: '失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
