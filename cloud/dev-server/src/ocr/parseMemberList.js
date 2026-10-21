import { PATHWAY_ALIASES, TITLE_ALIASES, compactNormalize, normalizeOcrText } from './normalizeOcr.js'

export const GAME_TITLES = TITLE_ALIASES.map((t) => t.canonical)
export const GAME_PATHWAYS = PATHWAY_ALIASES.map((p) => p.canonical)

function stripNoise(text) {
  return String(text || '')
    .replace(/[|【】\[\]\-_=+*~`'"“”‘’\\\/，,。]/g, '')
    .replace(/\s+/g, '')
}

function findAllTitles(compact) {
  const hits = []
  for (const { canonical, patterns } of TITLE_ALIASES) {
    for (const p of patterns) {
      let from = 0
      while (from < compact.length) {
        const i = compact.indexOf(p, from)
        if (i < 0) break
        hits.push({ index: i, end: i + p.length, value: canonical, matched: p })
        from = i + 1
      }
    }
  }
  // 同一位置保留最长匹配（俱乐部之星 > 会员）
  hits.sort((a, b) => a.index - b.index || b.matched.length - a.matched.length)
  const dedup = []
  let lastEnd = -1
  for (const h of hits) {
    if (h.index < lastEnd) continue
    dedup.push(h)
    lastEnd = h.end
  }
  return dedup
}

function findPathway(afterTitle) {
  let best = null
  for (const { canonical, patterns } of PATHWAY_ALIASES) {
    for (const p of patterns) {
      const i = afterTitle.indexOf(p)
      if (i < 0) continue
      if (!best || i < best.index || (i === best.index && p.length > best.matched.length)) {
        best = { index: i, end: i + p.length, value: canonical, matched: p }
      }
    }
  }
  return best
}

function cleanName(raw) {
  let name = String(raw || '')
    .replace(/[0-9０-９]+/g, '')
    .replace(/^[A-Za-z$\\/|]+/g, '')
    .replace(/^[^\u4e00-\u9fff·.•]+/g, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9·.•\-]/g, '')
    .replace(/[·.•]{2,}/g, '·')
    .trim()
  name = name.replace(/\./g, '·')
  // 去掉头像/序号装饰带来的前缀噪声
  name = name.replace(/^[·.•]+/, '')
  // 「警不加班之主」「瓶九敏啊」等：常见单字噪声前缀
  if (name.length >= 3 && /^[县蛭餐瓶识枝誓警孢箭魉哟日伟伊史东桧佳刀取詹震盛参泠柄]/.test(name)) {
    const trimmed = name.slice(1)
    if (trimmed.length >= 2) name = trimmed
  }
  return name
}

/** 从任意位置取出评分数字串并切分 */
function splitScores(text) {
  const run = String(text || '').match(/(\d{10,22})/)
  if (!run) {
    const loose = String(text || '').match(/\d{4,7}/g) || []
    // 避免贪婪 7 位误切：优先取前两个「看起来像评分」的
    const scored = []
    for (const n of loose) {
      const v = Number(n)
      if (v >= 1000 && v <= 9_999_999) scored.push(v)
    }
    if (scored.length >= 2) {
      return { powerScore: scored[0], fashionScore: scored[1] }
    }
    return null
  }
  const digits = run[1]
  const afterDigits = String(text).slice(run.index + digits.length)
  const options = []
  for (let plen = 5; plen <= 7; plen++) {
    for (let flen = 4; flen <= 6; flen++) {
      if (digits.length < plen + flen) continue
      const powerScore = Number(digits.slice(0, plen))
      const fashionScore = Number(digits.slice(plen, plen + flen))
      const rest = digits.slice(plen + flen)
      const weekly = rest.length >= 2 ? Number(rest.slice(0, 2)) : null
      const afterWeekly = (rest.length >= 2 ? rest.slice(2) : rest) + afterDigits
      let score = 0
      if (powerScore >= 10000 && powerScore <= 9_999_999) score += 2
      if (fashionScore >= 1000 && fashionScore <= 999_999) score += 2
      if (weekly != null && weekly >= 0 && weekly <= 120) score += 2
      if (weekly != null && /^(未分组|天|在线|\d{1,3}天)/.test(afterWeekly)) score += 6
      if (plen === 6) score += 1
      if (flen >= 5) score += 1
      options.push({ powerScore, fashionScore, weekly, score })
    }
  }
  options.sort((a, b) => b.score - a.score)
  return options[0] || null
}

function scoreConfidence({ characterName, title, pathway, powerScore, fashionScore }) {
  let score = 0.55
  if (characterName && characterName.length >= 2) score += 0.15
  else score -= 0.25
  if (GAME_TITLES.includes(title)) score += 0.1
  if (GAME_PATHWAYS.includes(pathway)) score += 0.1
  if (powerScore >= 1000 && powerScore <= 9999999) score += 0.1
  else score -= 0.2
  if (fashionScore >= 0 && fashionScore <= 9999999) score += 0.05
  if (!characterName || characterName.length < 2) score = Math.min(score, 0.35)
  if (/[a-zA-Z]{3,}/.test(characterName || '')) score -= 0.1
  return Math.max(0, Math.min(1, score))
}

function parseCompact(compact) {
  const candidates = []
  const seenScores = new Set()
  const titles = findAllTitles(compact)

  for (const titleHit of titles) {
    // 角色名：职位前一段（向前最多 16 字，避开上一行尾巴）
    const nameStart = Math.max(0, titleHit.index - 16)
    const nameRaw = compact.slice(nameStart, titleHit.index)
    const characterName = cleanName(nameRaw)

    const afterTitle = compact.slice(titleHit.end)
    const levelMatch = afterTitle.match(/^(\d{2,3})/)
    const afterLevel = levelMatch ? afterTitle.slice(levelMatch[1].length) : afterTitle

    const pathwayHit = findPathway(afterLevel)
    const pathway = pathwayHit?.value || '未填写'
    const afterPathway = pathwayHit ? afterLevel.slice(pathwayHit.end) : afterLevel

    const scores = splitScores(afterPathway)
    if (!scores) continue
    const { powerScore, fashionScore } = scores
    const key = `${powerScore}-${fashionScore}`
    if (seenScores.has(key)) continue
    seenScores.add(key)

    const row = {
      characterName,
      title: titleHit.value,
      pathway,
      powerScore,
      fashionScore,
      level: levelMatch ? Number(levelMatch[1]) : null,
    }
    const confidence = scoreConfidence(row)
    candidates.push({
      ...row,
      confidence,
      lowConfidence: confidence < 0.65 || !characterName || characterName.length < 2,
      issues: [
        !characterName || characterName.length < 2 ? '角色名需人工核对' : null,
        !GAME_PATHWAYS.includes(pathway) ? '途径未识别为常见值' : null,
        powerScore < 1000 ? '非凡评分异常' : null,
      ].filter(Boolean),
    })
  }
  return candidates
}

/**
 * 从 OCR 全文解析俱乐部成员列表行。
 */
export function parseMemberListText(rawText) {
  const normalized = normalizeOcrText(rawText)
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  // 1) 逐行
  const byLine = []
  const seen = new Set()
  for (const line of lines) {
    if (/玩家名称|非凡评分|风尚度|成员结构|申请列表/.test(stripNoise(line))) continue
    const compact = compactNormalize(line)
    if (compact.length < 8) continue
    for (const row of parseCompact(compact)) {
      const key = `${row.powerScore}-${row.fashionScore}`
      if (seen.has(key)) continue
      seen.add(key)
      byLine.push(row)
    }
  }

  // 2) 全文再扫一遍（防 OCR 断行把职位/评分拆开）
  const whole = parseCompact(compactNormalize(normalized))
  for (const row of whole) {
    const key = `${row.powerScore}-${row.fashionScore}`
    if (seen.has(key)) continue
    seen.add(key)
    byLine.push(row)
  }

  return byLine
}
