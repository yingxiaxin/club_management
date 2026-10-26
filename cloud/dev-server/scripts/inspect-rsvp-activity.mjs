import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tcb from '@cloudbase/node-sdk'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
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
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const login = JSON.parse(
  (
    await request('POST', '/api/auth/login', {
      body: JSON.stringify({
        username: 'superadmin',
        password: process.env.EMERGENCY_SUPER_PASSWORD,
      }),
    })
  ).text,
)
const token = login.data.token
const acts = JSON.parse((await request('GET', '/api/activities', { token })).text)
const hit = (acts.data || []).filter((a) => String(a.title || '').includes('日程'))
console.log(
  'matched activities',
  hit.map((a) => ({ id: a.id, title: a.title, status: a.status })),
)

const db = tcb
  .init({
    env: process.env.CLOUDBASE_ENV,
    secretId: process.env.CLOUDBASE_SECRET_ID,
    secretKey: process.env.CLOUDBASE_SECRET_KEY,
  })
  .database()

for (const a of hit.length ? hit : acts.data?.slice(0, 3) || []) {
  const rsvpRes = await db.collection('activity_rsvps').where({ activityId: a.id }).limit(100).get()
  const rows = rsvpRes.data || []
  console.log('\n===', a.title, a.id, 'rsvp count', rows.length)
  for (const r of rows) {
    let member = null
    let rawShape = null
    try {
      const mres = await db.collection('members').doc(String(r.memberId)).get()
      rawShape = Array.isArray(mres.data) ? 'array' : typeof mres.data
      member = Array.isArray(mres.data) ? mres.data[0] : mres.data
    } catch (e) {
      member = { error: e.message }
    }
    console.log({
      rsvpId: r._id,
      rsvpCharacterName: r.characterName,
      status: r.status,
      memberId: r.memberId,
      memberDocShape: rawShape,
      memberCharacterName: member?.characterName,
      memberStatus: member?.status,
    })
  }
  const exp = await request('GET', `/api/activities/${a.id}/rsvps/export.csv`, { token })
  console.log('export csv:\n' + exp.text)
}
