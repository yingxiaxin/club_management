const { callMemberApi } = require('../../utils/api')
const { pathwayClass } = require('../../utils/pathway')

const STATUS_TEXT = {
  active: '正常',
  pending: '待审核',
  left: '已退出',
}

function formatJoinedAt(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

Page({
  data: {
    loading: true,
    error: '',
    member: null,
    namePathwayTint: '',
    joinedAtText: '',
    statusText: '',
  },

  onLoad(query) {
    this.memberId = (query && query.id) || ''
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    if (!this.memberId) {
      this.setData({ loading: false, error: '缺少成员 id' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const member = await callMemberApi('getMember', { id: this.memberId })
      const cls = pathwayClass(member.pathway)
      this.setData({
        loading: false,
        member,
        namePathwayTint: cls ? `${cls} pathway-tint` : '',
        joinedAtText: formatJoinedAt(member.joinedAt),
        statusText: STATUS_TEXT[member.status] || member.status || '—',
      })
      if (member.characterName) {
        wx.setNavigationBarTitle({ title: member.characterName })
      }
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || '加载失败',
        member: null,
      })
    }
  },
})
