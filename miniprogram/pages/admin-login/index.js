Page({
  data: {
    ticketId: '',
    openid: '',
    loading: false,
    done: false,
    message: '',
  },

  onLoad(query) {
    const fromQuery = (query && (query.ticketId || query.ticket || query.scene)) || ''
    let ticketId = String(fromQuery)
    try {
      ticketId = decodeURIComponent(ticketId)
    } catch {
      /* ignore */
    }
    this.setData({ ticketId })
    this.refreshWhoami()
  },

  onPullDownRefresh() {
    this.refreshWhoami().finally(() => wx.stopPullDownRefresh())
  },

  onTicketInput(e) {
    this.setData({ ticketId: String(e.detail.value || '').trim() })
  },

  onCopyOpenid() {
    const { openid } = this.data
    if (!openid) return
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    })
  },

  async refreshWhoami() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'whoami' },
      })
      const result = res.result || {}
      if (result.ok && result.data) {
        this.setData({
          openid: result.data.openid || '',
          message: result.data.isAdmin
            ? `已识别管理员（${result.data.role}），可确认登录`
            : '当前微信尚未登记为管理员',
        })
      }
    } catch (e) {
      this.setData({ message: e.message || 'whoami 失败，请确认已部署 adminApi' })
    }
  },

  async onConfirm() {
    const { ticketId } = this.data
    if (!ticketId) {
      wx.showToast({ title: '缺少票号', icon: 'none' })
      return
    }
    this.setData({ loading: true, message: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'confirmAdminLogin', ticketId },
      })
      const result = res.result || {}
      if (!result.ok) {
        throw new Error(result.message || '确认失败')
      }
      this.setData({
        done: true,
        message: `已确认（${result.data.displayName || result.data.role}），请回到电脑端`,
      })
      wx.showToast({ title: '已确认', icon: 'success' })
    } catch (e) {
      this.setData({ message: e.message || '确认失败' })
      wx.showToast({ title: '失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
