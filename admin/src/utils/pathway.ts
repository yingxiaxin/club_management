/** 途径 → 色板 key（与 tokens / 视觉风格指南对齐） */

export type PathwayKey =
  | 'audience'
  | 'warrior'
  | 'bard'
  | 'apprentice'
  | 'diviner'
  | 'pryer'

const RULES: { key: PathwayKey; patterns: string[] }[] = [
  { key: 'pryer', patterns: ['窥秘'] },
  { key: 'diviner', patterns: ['占卜'] },
  { key: 'audience', patterns: ['观众'] },
  { key: 'warrior', patterns: ['战士'] },
  { key: 'apprentice', patterns: ['学徒'] },
  { key: 'bard', patterns: ['歌颂', '歌手'] },
]

export function resolvePathwayKey(pathway?: string | null): PathwayKey | null {
  const s = String(pathway || '')
  if (!s || s === '未填写') return null
  for (const { key, patterns } of RULES) {
    if (patterns.some((p) => s.includes(p))) return key
  }
  return null
}

/** Element Plus el-table :row-class-name（左侧细色条） */
export function pathwayRowClassName({ row }: { row: { pathway?: string } }) {
  const key = resolvePathwayKey(row?.pathway)
  return key ? `pathway-row-${key}` : ''
}

/** 途径色签 class */
export function pathwayTagClass(pathway?: string | null) {
  const key = resolvePathwayKey(pathway)
  return key ? `pathway-tag-${key}` : ''
}
