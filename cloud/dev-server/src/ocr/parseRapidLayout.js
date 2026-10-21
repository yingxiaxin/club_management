import { PATHWAY_ALIASES, TITLE_ALIASES, normalizeOcrText } from './normalizeOcr.js'
import { GAME_PATHWAYS, GAME_TITLES } from './parseMemberList.js'

const TITLE_SET = new Set(TITLE_ALIASES.flatMap((t) => t.patterns))

function canonicalTitle(text) {
  const t = normalizeOcrText(String(text || '').replace(/\s+/g, ''))
  for (const { canonical, patterns } of TITLE_ALIASES) {
    if (patterns.some((p) => t === p || t.includes(p))) return canonical
  }
  return null
}

function canonicalPathway(text) {
  const t = normalizeOcrText(String(text || '').replace(/\s+/g, ''))
  for (const { canonical, patterns } of PATHWAY_ALIASES) {
    if (patterns.some((p) => t === p || t.includes(p))) return canonical
  }
  return null
}

function cleanName(raw) {
  let name = normalizeOcrText(String(raw || ''))
    .replace(/\s+/g, '')
    .replace(/[0-9０-９]+/g, '')
    .replace(/^[^\u4e00-\u9fff·.•]+/g, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9·.•\-]/g, '')
    .replace(/[·.•]{2,}/g, '·')
    .replace(/\./g, '·')
    .replace(/^[·.•]+/, '')
    .trim()
  // 误把头衔并进姓名
  for (const p of TITLE_SET) {
    if (name.endsWith(p) && name.length > p.length + 1) name = name.slice(0, -p.length)
  }
  return name
}

function isHeaderNoise(text) {
  const t = String(text || '').replace(/\s+/g, '')
  return /玩家名称|非凡评分|风尚度|成员结构|申请列表|当前状态|入会时间|周活跃|职位|等级|途径|分组/.test(
    t,
  )
}

function clusterRows(items, yTol) {
  const sorted = [...items].sort((a, b) => a.cy - b.cy || a.cx - b.cx)
  const rows = []
  for (const it of sorted) {
    let row = rows.find((r) => Math.abs(r.cy - it.cy) <= yTol)
    if (!row) {
      row = { cy: it.cy, items: [] }
      rows.push(row)
    }
    row.items.push(it)
    row.cy = (row.cy * (row.items.length - 1) + it.cy) / row.items.length
  }
  for (const row of rows) row.items.sort((a, b) => a.cx - b.cx)
  return rows
}

function pickByX(rowItems, x0, x1) {
  return rowItems.filter((it) => it.cx >= x0 && it.cx < x1)
}

function scoreConfidence(row) {
  let score = 0.6
  if (row.characterName && row.characterName.length >= 2) score += 0.2
  else score -= 0.25
  if (GAME_TITLES.includes(row.title)) score += 0.08
  if (GAME_PATHWAYS.includes(row.pathway)) score += 0.08
  if (row.powerScore >= 1000) score += 0.08
  if (row.level >= 1) score += 0.04
  return Math.max(0, Math.min(1, score))
}

/**
 * 用 RapidOCR 带框结果解析俱乐部成员列表。
 * @param {{text:string,score:number,cx:number,cy:number,x0:number,x1:number,y0:number,y1:number}[]} items
 * @param {{width:number,height:number}} meta
 */
export function parseRapidLayout(items, meta = {}) {
  const width = meta.width || 1920
  const height = meta.height || 1080
  const usable = (items || []).filter((it) => it.text && !isHeaderNoise(it.text))
  if (!usable.length) return []

  const yTol = Math.max(18, height * 0.022)
  const rows = clusterRows(usable, yTol)

  // 列边界：优先用表头词定位；否则按全屏游戏 UI 比例
  const header = (items || []).filter((it) => isHeaderNoise(it.text))
  const findHeaderX = (re) => header.find((h) => re.test(h.text.replace(/\s+/g, '')))?.cx

  const nameX = findHeaderX(/玩家名称/) ?? width * 0.16
  const titleX = findHeaderX(/职位/) ?? width * 0.26
  const levelX = findHeaderX(/等级/) ?? width * 0.345
  const pathwayX = findHeaderX(/途径/) ?? width * 0.43
  const powerX = findHeaderX(/非凡/) ?? width * 0.51
  const fashionX = findHeaderX(/风尚/) ?? width * 0.6

  const bounds = {
    name: [Math.max(0, nameX - width * 0.06), (nameX + titleX) / 2],
    title: [(nameX + titleX) / 2, (titleX + levelX) / 2],
    level: [(titleX + levelX) / 2, (levelX + pathwayX) / 2],
    pathway: [(levelX + pathwayX) / 2, (pathwayX + powerX) / 2],
    power: [(pathwayX + powerX) / 2, (powerX + fashionX) / 2],
    fashion: [(powerX + fashionX) / 2, fashionX + width * 0.08],
  }

  const candidates = []
  const seen = new Set()

  for (const row of rows) {
    const nameParts = pickByX(row.items, bounds.name[0], bounds.name[1])
      .map((it) => it.text)
      .join('')
    const characterName = cleanName(nameParts)

    let title = '成员'
    for (const it of pickByX(row.items, bounds.title[0], bounds.title[1])) {
      const c = canonicalTitle(it.text)
      if (c) {
        title = c
        break
      }
    }
    // 行内兜底：任意位置扫职位
    if (title === '成员') {
      for (const it of row.items) {
        const c = canonicalTitle(it.text)
        if (c) {
          title = c
          break
        }
      }
    }

    let level = 0
    for (const it of pickByX(row.items, bounds.level[0], bounds.level[1])) {
      const m = String(it.text).match(/\d{2,3}/)
      if (m) {
        const n = Number(m[0])
        if (n >= 1 && n <= 200) {
          level = n
          break
        }
      }
    }

    let pathway = '未填写'
    for (const it of pickByX(row.items, bounds.pathway[0], bounds.pathway[1])) {
      const c = canonicalPathway(it.text)
      if (c) {
        pathway = c
        break
      }
    }
    if (pathway === '未填写') {
      for (const it of row.items) {
        const c = canonicalPathway(it.text)
        if (c) {
          pathway = c
          break
        }
      }
    }

    const nums = row.items
      .map((it) => String(it.text).replace(/[^\d]/g, ''))
      .filter((d) => d.length >= 4 && d.length <= 7)
      .map(Number)
      .filter((n) => n >= 1000 && n <= 9_999_999)

    // 按 x 取非凡评分 / 风尚度
    const powerHit = pickByX(row.items, bounds.power[0], bounds.power[1])
      .map((it) => Number(String(it.text).replace(/[^\d]/g, '')))
      .find((n) => n >= 1000 && n <= 9_999_999)
    const fashionHit = pickByX(row.items, bounds.fashion[0], bounds.fashion[1])
      .map((it) => Number(String(it.text).replace(/[^\d]/g, '')))
      .find((n) => n >= 1000 && n <= 9_999_999)

    let powerScore = powerHit || 0
    let fashionScore = fashionHit || 0
    if (!powerScore && nums.length >= 1) powerScore = nums[0]
    if (!fashionScore && nums.length >= 2) fashionScore = nums[1]

    if (!powerScore) continue
    // 过滤无姓名且无职位的噪声行
    if (!characterName && title === '成员') continue

    const key = `${powerScore}-${fashionScore}`
    if (seen.has(key)) continue
    seen.add(key)

    const base = {
      characterName,
      title,
      pathway,
      level,
      powerScore,
      fashionScore,
    }
    const confidence = scoreConfidence(base)
    candidates.push({
      ...base,
      confidence,
      lowConfidence: confidence < 0.7 || !characterName || characterName.length < 2,
      issues: [
        !characterName || characterName.length < 2 ? '角色名需人工核对' : null,
        !GAME_PATHWAYS.includes(pathway) ? '途径未识别为常见值' : null,
      ].filter(Boolean),
    })
  }

  return candidates
}

/** 将框结果压成纯文本，供旧解析器兜底 */
export function rapidItemsToText(items) {
  const rows = clusterRows(items || [], 22)
  return rows
    .map((r) => r.items.map((it) => it.text).join(' '))
    .join('\n')
}
