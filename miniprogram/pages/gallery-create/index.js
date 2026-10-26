const { callMemberApi } = require('../../utils/api')
const { MAX_PICK, pickCompressAndUploadMany } = require('../../utils/galleryUpload')

Page({
  data: {
    items: [],
    caption: '',
    submitting: false,
    message: '',
    memberId: '',
  },

  onShow() {
    this.ensureWhoami()
  },

  async ensureWhoami() {
    try {
      const data = await callMemberApi('whoami')
      if (!data.memberId) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后才能发布。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
            else wx.navigateBack({ fail: () => {} })
          },
        })
        return
      }
      this.setData({ memberId: data.memberId })
    } catch (e) {
      this.setData({ message: e.message || '无法识别身份' })
    }
  },

  onCaption(e) {
    this.setData({ caption: String(e.detail.value || '') })
  },

  onRemove(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index)) return
    const items = this.data.items.slice()
    items.splice(index, 1)
    this.setData({ items })
  },

  async onPick() {
    if (this.data.submitting) return
    if (!this.data.memberId) {
      await this.ensureWhoami()
      if (!this.data.memberId) return
    }
    const remain = MAX_PICK - this.data.items.length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${MAX_PICK} 张`, icon: 'none' })
      return
    }
    this.setData({ message: '' })
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      const added = await pickCompressAndUploadMany(this.data.memberId, { remain })
      const stamped = added.map((row, i) => ({
        ...row,
        localKey: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      }))
      const items = this.data.items.concat(stamped).slice(0, MAX_PICK)
      this.setData({ items })
    } catch (e) {
      const msg = e.message || '选图失败'
      if (!/cancel|取消/i.test(msg)) {
        this.setData({ message: msg })
        wx.showToast({ title: '失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async onSubmit() {
    const { items, caption, submitting } = this.data
    if (submitting || !items.length) return
    this.setData({ submitting: true, message: '' })
    let ok = 0
    let lastErr = ''
    try {
      for (const item of items) {
        try {
          await callMemberApi('createGalleryPost', {
            imageFileId: item.imageFileId,
            thumbFileId: item.thumbFileId,
            byteSize: item.byteSize,
            caption,
          })
          ok += 1
        } catch (e) {
          lastErr = e.message || '发布失败'
        }
      }
      if (ok === items.length) {
        wx.showToast({ title: `已发布 ${ok} 张`, icon: 'success' })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/gallery/index' }) })
        }, 400)
      } else if (ok > 0) {
        this.setData({
          message: `成功 ${ok} 张，失败 ${items.length - ok} 张：${lastErr}`,
          items: items.slice(ok),
        })
        wx.showToast({ title: '部分失败', icon: 'none' })
      } else {
        this.setData({ message: lastErr || '发布失败' })
        wx.showToast({ title: '失败', icon: 'none' })
      }
    } finally {
      this.setData({ submitting: false })
    }
  },
})
