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

/** 成员列表途径多选筛选项（含「未填写」） */
export const PATHWAY_FILTER_OPTIONS = [
  '观众',
  '战士',
  '歌颂',
  '学徒',
  '占卜',
  '窥秘',
  '未填写',
] as const

/** 新增/编辑表单途径单选（不含「未填写」；清空即未填写） */
export const PATHWAY_FORM_OPTIONS = [
  '观众',
  '战士',
  '歌颂',
  '学徒',
  '占卜',
  '窥秘',
] as const

const FORM_BY_KEY: Record<PathwayKey, (typeof PATHWAY_FORM_OPTIONS)[number]> = {
  audience: '观众',
  warrior: '战士',
  bard: '歌颂',
  apprentice: '学徒',
  diviner: '占卜',
  pryer: '窥秘',
}

export function resolvePathwayKey(pathway?: string | null): PathwayKey | null {
  const s = String(pathway || '')
  if (!s || s === '未填写') return null
  for (const { key, patterns } of RULES) {
    if (patterns.some((p) => s.includes(p))) return key
  }
  return null
}

/** 编辑回填：历史「观众途径」等归一到表单单选项 */
export function normalizePathwayFormValue(pathway?: string | null): string {
  const key = resolvePathwayKey(pathway)
  return key ? FORM_BY_KEY[key] : ''
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
