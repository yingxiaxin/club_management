import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, '../../../miniprogram/assets/tab')
fs.mkdirSync(dir, { recursive: true })

async function icon(name, paths, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 81 81">
    <g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir, name))
}

const muted = '#a09078'
const brand = '#c9a227'
const home =
  '<path d="M16 36 L40.5 16 L65 36"/><path d="M24 34 V62 H57 V34"/>'
const cal =
  '<rect x="18" y="22" width="45" height="42" rx="4"/><path d="M18 34 H63"/><path d="M30 16 V28"/><path d="M51 16 V28"/><path d="M30 44 H36"/><path d="M45 44 H51"/>'
const people =
  '<circle cx="32" cy="30" r="10"/><path d="M16 58 C16 46 48 46 48 58"/><circle cx="54" cy="32" r="8"/><path d="M50 58 C52 50 72 50 70 58"/>'

await icon('home.png', home, muted)
await icon('home-active.png', home, brand)
await icon('activity.png', cal, muted)
await icon('activity-active.png', cal, brand)
await icon('members.png', people, muted)
await icon('members-active.png', people, brand)
console.log('ok', fs.readdirSync(dir))
