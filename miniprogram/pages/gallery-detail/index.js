const { callMemberApi } = require('../../utils/api')
const { MAX_PICK, pickCompressAndUploadMany } = require('../../utils/galleryUpload')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateTime(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

Page({
  data: {
    loading: true,
    error: '',
    album: null,
    canDelete: false,
    canAppend: false,
    canLike: false,
    withdrawing: false,
    removingId: '',
    appending: false,
    liking: false,
  },

  albumRef: '',
  memberId: '',

  onLoad(query) {
    this.albumRef = query.id ? decodeURIComponent(String(query.id)) : ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    if (!this.albumRef) {
      this.setData({ loading: false, error: '缺少作品 id' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const [album, me] = await Promise.all([
        callMemberApi('getGalleryPost', { id: this.albumRef }),
        callMemberApi('whoami').catch(() => null),
      ])
      const images = Array.isArray(album.images)
        ? album.images
        : album.imageFileId
          ? [
              {
                id: album.id,
                imageFileId: album.imageFileId,
                thumbFileId: album.thumbFileId,
                byteSize: album.byteSize,
              },
            ]
          : []
      const isAuthor = Boolean(me && me.memberId && album.memberId === me.memberId)
      // 小程序仅作者可见撤回/删图；管理员走 PC 后台
      const canDelete = isAuthor
      const canAppend = Boolean(isAuthor && images.length < MAX_PICK)
      const canLike = Boolean(me && me.memberId)
      this.albumRef = album.albumId || album.id || this.albumRef
      this.memberId = me && me.memberId ? me.memberId : ''
      const caption = String(album.caption || '').trim()
      this.setData({
        loading: false,
        album: {
          ...album,
          images,
          title: caption || '未命名作品',
          createdAtLabel: formatDateTime(album.createdAt),
          likeCount: Number(album.likeCount) || 0,
          likedByMe: Boolean(album.likedByMe),
        },
        canDelete,
        canAppend,
        canLike,
      })
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        album: null,
        canDelete: false,
        canAppend: false,
        canLike: false,
      })
      if (e.status === 403) {
        wx.showModal({
          title: '需要先关联角色',
          content: '关联游戏角色后即可查看。',
          confirmText: '去关联',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/join/index' })
          },
        })
      }
    }
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url
    const album = this.data.album
    if (!url || !album) return
    const urls = (album.images || []).map((i) => i.imageFileId).filter(Boolean)
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  async onToggleLike() {
    if (!this.data.canLike || this.data.liking || !this.albumRef) return
    this.setData({ liking: true })
    try {
      const res = await callMemberApi('toggleGalleryLike', { albumId: this.albumRef })
      this.setData({
        'album.likedByMe': Boolean(res.liked),
        'album.likeCount': Number(res.likeCount) || 0,
      })
    } catch (e) {
      wx.showToast({ title: e.message || '点赞失败', icon: 'none' })
    } finally {
      this.setData({ liking: false })
    }
  },

  onWithdraw() {
    if (this.data.withdrawing || !this.albumRef) return
    wx.showModal({
      title: '撤回作品',
      content: '将删除本作品下全部图片，且不可恢复。确定继续？',
      confirmText: '撤回',
      success: (res) => {
        if (res.confirm) this.doWithdraw()
      },
    })
  },

  async doWithdraw() {
    this.setData({ withdrawing: true })
    try {
      await callMemberApi('deleteGalleryAlbum', { albumId: this.albumRef })
      wx.showToast({ title: '已撤回', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/gallery/index' }) })
      }, 400)
    } catch (e) {
      wx.showToast({ title: e.message || '撤回失败', icon: 'none' })
    } finally {
      this.setData({ withdrawing: false })
    }
  },

  onRemoveImage(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.removingId) return
    const onlyOne = (this.data.album?.images || []).length <= 1
    wx.showModal({
      title: onlyOne ? '删除最后一张' : '删除图片',
      content: onlyOne
        ? '这是最后一张图，删除后作品将一并撤回。确定？'
        : '仅删除这一张，其它图片保留。确定？',
      confirmText: '删除',
      success: (res) => {
        if (res.confirm) this.doRemoveImage(id)
      },
    })
  },

  async doRemoveImage(id) {
    this.setData({ removingId: id })
    try {
      await callMemberApi('deleteGalleryPost', { id })
      wx.showToast({ title: '已删除', icon: 'success' })
      const left = (this.data.album?.images || []).filter((i) => i.id !== id)
      if (!left.length) {
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/gallery/index' }) })
        }, 400)
        return
      }
      await this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    } finally {
      this.setData({ removingId: '' })
    }
  },

  async onAppend() {
    if (!this.data.canAppend || this.data.appending || !this.memberId) return
    const album = this.data.album
    if (!album) return
    const remain = MAX_PICK - (album.images || []).length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${MAX_PICK} 张`, icon: 'none' })
      return
    }
    this.setData({ appending: true })
    wx.showLoading({ title: '上传中…', mask: true })
    try {
      const added = await pickCompressAndUploadMany(this.memberId, { remain })
      let ok = 0
      let lastErr = ''
      const caption = String(album.caption || '')
      for (const item of added) {
        try {
          await callMemberApi('createGalleryPost', {
            albumId: this.albumRef,
            imageFileId: item.imageFileId,
            thumbFileId: item.thumbFileId,
            byteSize: item.byteSize,
            caption,
          })
          ok += 1
        } catch (e) {
          lastErr = e.message || '上传失败'
        }
      }
      if (ok === added.length) {
        wx.showToast({ title: `已添加 ${ok} 张`, icon: 'success' })
      } else if (ok > 0) {
        wx.showToast({ title: `成功 ${ok} 张，部分失败`, icon: 'none' })
      } else {
        wx.showToast({ title: lastErr || '上传失败', icon: 'none' })
      }
      await this.load()
    } catch (e) {
      const msg = e.message || '选图失败'
      if (!/cancel|取消/i.test(msg)) {
        wx.showToast({ title: msg, icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ appending: false })
    }
  },
})
