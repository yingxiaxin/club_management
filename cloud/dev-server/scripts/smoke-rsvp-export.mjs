import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env')
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

function request(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3789,
        path: urlPath,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'],
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const pwd = process.env.EMERGENCY_SUPER_PASSWORD
const loginRes = await request('POST', '/api/auth/login', {
  body: JSON.stringify({ username: 'superadmin', password: pwd }),
})
const login = JSON.parse(loginRes.text)
if (!login.ok) {
  console.error('login fail', login.message)
  process.exit(1)
}
const token = login.data.token
const actsRes = await request('GET', '/api/activities', { token })
const acts = JSON.parse(actsRes.text)
const row = acts.data?.[0]
console.log('first activity', row?.id, row?.title)
const expRes = await request('GET', `/api/activities/${row.id}/rsvps/export.csv`, { token })
console.log('status', expRes.status, expRes.contentType)
console.log(expRes.text.slice(0, 800))
