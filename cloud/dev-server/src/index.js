import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { fileURLToPath } from 'node:url'
import {
  annotateCandidates,
  authFromToken,
  batchUpdateScores,
  createMember,
  createOcrJob,
  createSessionFromWechat,
  deleteMember,
  getMember,
  getOcrJob,
  listMembers,
  login,
  updateMember,
  upsertMembersByName,
} from './store.js'
import * as cloudMembers from './cloudMembers.js'
import * as cloudAuth from './cloudAuth.js'
import * as cloudInvites from './cloudInvites.js'
import { recognizeMemberScreenshots } from './ocr/recognize.js'

// 加载 cloud/dev-server/.env（可选腾讯云 OCR / 云开发密钥），不覆盖已有环境变量
;(() => {
  try {
    const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
    if (!fs.existsSync(envFile)) return
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      if (process.env[k] === undefined) process.env[k] = v
    }
  } catch {
    /* ignore */
  }
})()

cloudMembers.loadEnvDefaultsFromRepo()

/** DATA_BACKEND=cloud 且配齐密钥时，成员读写走云数据库 */
function useCloudMembers() {
  return process.env.DATA_BACKEND === 'cloud' && cloudMembers.isCloudMembersConfigured()
}

const membersApi = {
  list: (q) => (useCloudMembers() ? cloudMembers.listMembers(q) : Promise.resolve(listMembers(q))),
  get: (id) => (useCloudMembers() ? cloudMembers.getMember(id) : Promise.resolve(getMember(id))),
  create: (body) =>
    useCloudMembers() ? cloudMembers.createMember(body) : Promise.resolve(createMember(body)),
  update: (id, body) =>
    useCloudMembers() ? cloudMembers.updateMember(id, body) : Promise.resolve(updateMember(id, body)),
  remove: (id) =>
    useCloudMembers() ? cloudMembers.deleteMember(id) : Promise.resolve(deleteMember(id)),
  batchScores: (items) =>
    useCloudMembers()
      ? cloudMembers.batchUpdateScores(items)
      : Promise.resolve(batchUpdateScores(items)),
  annotate: (cands) =>
    useCloudMembers()
      ? cloudMembers.annotateCandidates(cands)
      : Promise.resolve(annotateCandidates(cands)),
  upsert: (rows, opts) =>
    useCloudMembers()
      ? cloudMembers.upsertMembersByName(rows, opts)
      : Promise.resolve(upsertMembersByName(rows, opts)),
}

const app = express()
const PORT = Number(process.env.PORT) || 3789
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
})

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
  res.json({
    ok: true,
    service: 'club-dev-server',
    stage: 'P0-e-invite',
    membersBackend: useCloudMembers() ? 'cloud' : 'json',
    qrLogin: cloudAuth.isQrLoginConfigured(),
    /** 本机 AppSecret 是否已配（不返回密钥本身） */
    wxacodeLocal: cloudAuth.canGenerateWxacodeLocally(),
    invites: useCloudMembers(),
  })
})

function requireCloudInvites(res) {
  if (!useCloudMembers()) {
    res.status(503).json({
      ok: false,
      message: '邀请码需 DATA_BACKEND=cloud 并配置 CLOUDBASE_*',
    })
    return false
  }
  return true
}

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {}
    const data = login(String(username || ''), String(password || ''))
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

/** 创建扫码登录票 + 小程序码（需云开发密钥且已部署 adminApi） */
app.post('/api/auth/qr/start', async (_req, res) => {
  try {
    if (!cloudAuth.isQrLoginConfigured()) {
      return res.status(503).json({
        ok: false,
        message: '未配置云开发密钥，无法扫码登录；请用应急账号或配置 CLOUDBASE_*',
      })
    }
    const data = await cloudAuth.startQrLogin()
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

/** 轮询扫码状态；首次 confirmed 时签发本地 token 并消费票 */
app.get('/api/auth/qr/:ticketId', async (req, res) => {
  try {
    if (!cloudAuth.isQrLoginConfigured()) {
      return res.status(503).json({ ok: false, message: '未配置云开发密钥' })
    }
    const ticketId = req.params.ticketId
    const ticket = await cloudAuth.pollQrLogin(ticketId)
    if (ticket.status === 'confirmed') {
      const consumed = await cloudAuth.consumeQrLogin(ticketId)
      const data = createSessionFromWechat(consumed)
      return res.json({ ok: true, data: { status: 'confirmed', ...data } })
    }
    res.json({
      ok: true,
      data: {
        status: ticket.status,
        expiresAt: ticket.expiresAt,
        ticketId: ticket.ticketId,
      },
    })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ ok: true, data: req.user })
})

app.get('/api/members', requireAdmin, async (req, res) => {
  try {
    const data = await membersApi.list(req.query)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/members/export.csv', requireAdmin, async (req, res) => {
  try {
    const list = await membersApi.list(req.query)
    const header = ['角色名', '等级', '非凡评分', '风尚度', '序列途径', '职位', '备注', '入会时间']
    const lines = [header.join(',')]
    for (const m of list) {
      const cells = [
        m.characterName,
        m.level || '',
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
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const row = await membersApi.get(req.params.id)
    if (!row || row.status === 'left') {
      return res.status(404).json({ ok: false, message: '成员不存在' })
    }
    res.json({ ok: true, data: row })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.post('/api/members', requireAdmin, async (req, res) => {
  try {
    const data = await membersApi.create(req.body || {})
    res.status(201).json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.put('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const data = await membersApi.update(req.params.id, req.body || {})
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.delete('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const data = await membersApi.remove(req.params.id)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.post('/api/members/batch-scores', requireAdmin, async (req, res) => {
  try {
    const data = await membersApi.batchScores(req.body?.items || [])
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

/** —— P0-e 邀请码 / 入会申请（云库） —— */
app.get('/api/invites', requireAdmin, async (_req, res) => {
  try {
    if (!requireCloudInvites(res)) return
    res.json({ ok: true, data: await cloudInvites.listInviteCodes() })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.post('/api/invites', requireAdmin, async (req, res) => {
  try {
    if (!requireCloudInvites(res)) return
    const data = await cloudInvites.createInviteCode(req.body || {}, req.user?.username)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.patch('/api/invites/:id', requireAdmin, async (req, res) => {
  try {
    if (!requireCloudInvites(res)) return
    const data = await cloudInvites.updateInviteCode(req.params.id, req.body || {})
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.get('/api/join-applications', requireAdmin, async (req, res) => {
  try {
    if (!requireCloudInvites(res)) return
    const data = await cloudInvites.listApplications({ status: req.query.status })
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.post('/api/join-applications/:id/review', requireAdmin, async (req, res) => {
  try {
    if (!requireCloudInvites(res)) return
    const decision = req.body?.decision || req.body?.status
    const data = await cloudInvites.reviewApplication(req.params.id, {
      decision,
      reviewer: req.user?.username || req.user?.displayName,
    })
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

/** 截图 OCR：上传 → 解析 → 返回可编辑候选（须再调 commit） */
app.post('/api/ocr/parse', requireAdmin, upload.array('images', 12), async (req, res) => {
  try {
    const files = req.files || []
    if (!files.length) {
      return res.status(400).json({ ok: false, message: '请上传至少一张截图' })
    }
    const buffers = files.map((f) => f.buffer)
    const { rawText, candidates, tip, provider } = await recognizeMemberScreenshots(buffers)
    const annotated = await membersApi.annotate(candidates)
    if (!annotated.length) {
      return res.status(422).json({
        ok: false,
        message: '未能解析出成员行，请确认是「俱乐部成员列表」截图，或改用手录',
        data: { rawText },
      })
    }
    const job = createOcrJob({
      createdBy: req.user.username,
      imageNames: files.map((f) => f.originalname || 'image'),
      rawText,
      candidates: annotated,
    })
    res.json({
      ok: true,
      data: {
        jobId: job.id,
        status: job.status,
        candidates: annotated,
        rawText,
        provider: provider || 'tesseract',
        tip: tip || '角色名易受头像遮挡，请核对后再导入',
      },
    })
  } catch (err) {
    console.error('[ocr/parse]', err)
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || '识别失败',
    })
  }
})

app.get('/api/ocr/jobs/:id', requireAdmin, (req, res) => {
  const job = getOcrJob(req.params.id)
  if (!job) return res.status(404).json({ ok: false, message: '识别任务不存在' })
  res.json({ ok: true, data: job })
})

/** 人工确认后按角色名新增/更新 */
app.post('/api/ocr/commit', requireAdmin, async (req, res) => {
  try {
    const { jobId, rows } = req.body || {}
    if (!jobId) return res.status(400).json({ ok: false, message: '缺少 jobId' })
    const job = getOcrJob(jobId)
    if (!job) return res.status(404).json({ ok: false, message: '识别任务不存在' })
    if (job.status === 'committed') {
      return res.status(409).json({ ok: false, message: '该任务已导入，请勿重复提交' })
    }
    const selected = (rows || []).filter((r) => r && r.selected !== false)
    if (!selected.length) {
      return res.status(400).json({ ok: false, message: '请至少勾选一行' })
    }
    for (const r of selected) {
      if (!String(r.characterName || '').trim()) {
        return res.status(400).json({ ok: false, message: '存在空角色名，请补全或取消勾选' })
      }
    }
    const data = await membersApi.upsert(selected, { ocrJobId: jobId })
    res.json({ ok: true, data })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`[club-dev-server] http://127.0.0.1:${PORT}`)
  console.log(
    `成员数据源: ${useCloudMembers() ? '云数据库 members' : '本地 JSON'}（DATA_BACKEND=${process.env.DATA_BACKEND || 'json'}）`,
  )
  console.log('应急账号: superadmin / club-change-me  或  admin / club-change-me')
})
