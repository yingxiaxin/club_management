import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import FormData from 'form-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const img = path.resolve(__dirname, '../../../游戏截图/俱乐部成员列表.png')

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    if (body && typeof body.pipe === 'function') body.pipe(req)
    else {
      if (body) req.write(body)
      req.end()
    }
  })
}

const loginBody = JSON.stringify({ username: 'superadmin', password: 'club-change-me' })
const loginJson = await request(
  {
    hostname: '127.0.0.1',
    port: 3789,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody),
    },
  },
  loginBody,
)
if (!loginJson.ok) throw new Error(loginJson.message)
const token = loginJson.data.token
console.log('login ok')

const form = new FormData()
form.append('images', fs.createReadStream(img))
const parseJson = await request(
  {
    hostname: '127.0.0.1',
    port: 3789,
    path: '/api/ocr/parse',
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
  },
  form,
)
if (!parseJson.ok) throw new Error(parseJson.message || 'parse failed')
console.log('parse rows', parseJson.data.candidates.length)

const fixedNames = [
  '月光馆',
  '杭泺',
  '九敏啊',
  '冷枫',
  '不加班之主',
  '诺克斯·加缪',
  '栖霜',
  '勉勉不知道噢',
  '小羊不吃葱',
]
const rows = parseJson.data.candidates.map((c, i) => ({
  ...c,
  characterName: fixedNames[i] || c.characterName,
  selected: true,
}))
const commitBody = JSON.stringify({ jobId: parseJson.data.jobId, rows })
const commitJson = await request(
  {
    hostname: '127.0.0.1',
    port: 3789,
    path: '/api/ocr/commit',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(commitBody),
    },
  },
  commitBody,
)
if (!commitJson.ok) throw new Error(commitJson.message || 'commit failed')
console.log(
  'commit',
  `created=${commitJson.data.created.length}`,
  `updated=${commitJson.data.updated.length}`,
)
console.log('E2E OK')
