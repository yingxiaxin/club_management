/**
 * 管理端成员列表「途径」多选筛选。
 * 查询参数：逗号分隔，如 pathway=观众,战士；「未填写」匹配空/未填写。
 */

const ALIASES = {
  观众: ['观众'],
  战士: ['战士'],
  歌颂: ['歌颂', '歌手'],
  学徒: ['学徒'],
  占卜: ['占卜'],
  窥秘: ['窥秘'],
}

export function parsePathwayParam(pathway) {
  if (Array.isArray(pathway)) {
    return pathway
      .flatMap((p) => String(p || '').split(/[,，]/))
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return String(pathway || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function memberMatchesPathways(memberPathway, pathwayParam) {
  const selected = parsePathwayParam(pathwayParam)
  if (!selected.length) return true
  const raw = String(memberPathway || '').trim()
  return selected.some((sel) => {
    if (sel === '未填写') return !raw || raw === '未填写'
    const keys = ALIASES[sel] || [sel]
    return keys.some((k) => raw.includes(k))
  })
}
