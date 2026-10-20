import cors from 'cors'
import express from 'express'
import {
  authFromToken,
  batchUpdateScores,
  createMember,
  deleteMember,
  getMember,
  listMembers,
  login,
  updateMember,
} from './store.js'

const app = express()
const PORT = Number(process.env.PORT) || 3789

app.use(cors())
app.use(express.json({ limit: '2mb' }))

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const user = authFromToken(token)
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return res.status(401).json({ ok: false, message: '未登录或无权限' })
  }
  req.user = user
  next()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'club-dev-server', stage: 'P0-a' })
})

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {}
    const data = login(String(username || ''), String(password || ''))
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ ok: true, data: req.user })
})

app.get('/api/members', requireAdmin, (req, res) => {
  try {
    const data = listMembers(req.query)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/members/:id', requireAdmin, (req, res) => {
  const row = getMember(req.params.id)
  if (!row || row.status === 'left') {
    return res.status(404).json({ ok: false, message: '成员不存在' })
  }
  res.json({ ok: true, data: row })
})

app.post('/api/members', requireAdmin, (req, res) => {
  try {
    const data = createMember(req.body || {})
    res.status(201).json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.put('/api/members/:id', requireAdmin, (req, res) => {
  try {
    const data = updateMember(req.params.id, req.body || {})
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.delete('/api/members/:id', requireAdmin, (req, res) => {
  try {
    const data = deleteMember(req.params.id)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.post('/api/members/batch-scores', requireAdmin, (req, res) => {
  try {
    const data = batchUpdateScores(req.body?.items || [])
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/members/export.csv', requireAdmin, (req, res) => {
  const list = listMembers(req.query)
  const header = ['角色名', '非凡评分', '风尚度', '序列途径', '职位', '备注', '入会时间']
  const lines = [header.join(',')]
  for (const m of list) {
    const cells = [
      m.characterName,
      m.powerScore,
      m.fashionScore,
      m.pathway,
      m.title,
      m.remark,
      m.joinedAt,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
    lines.push(cells.join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="members.csv"')
  res.send('\uFEFF' + lines.join('\n'))
})

app.listen(PORT, () => {
  console.log(`[club-dev-server] http://127.0.0.1:${PORT}`)
  console.log('应急账号: superadmin / club-change-me  或  admin / club-change-me')
})
