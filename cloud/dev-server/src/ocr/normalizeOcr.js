/** 常见 OCR 形近字 / 误识，用于职位、途径归一 */

const CHAR_FIXES = [
  [/佬乐部/g, '俱乐部'],
  [/供乐部/g, '俱乐部'],
  [/任乐部/g, '俱乐部'],
  [/俱部之星/g, '俱乐部之星'],
  [/佬乐部之星/g, '俱乐部之星'],
  [/供乐部之星/g, '俱乐部之星'],
  [/IE式会员/gi, '正式会员'],
  [/I式会员/gi, '正式会员'],
  [/币式会员/g, '正式会员'],
  [/伟式会员/g, '正式会员'],
  [/正式会伟/g, '正式会员'],
  [/正式会员口/g, '正式会员'],
  [/正会会员/g, '正式会员'],
  [/占卜宾/g, '占卜家'],
  [/占卞家/g, '占卜家'],
  [/占下家/g, '占卜家'],
  [/占\s*家/g, '占卜家'],
  [/窥秘入/g, '窥秘人'],
  [/罕秘人/g, '窥秘人'],
  [/观传/g, '观众'],
  [/学徙/g, '学徒'],
  [/战土/g, '战士'],
  [/未分绍/g, '未分组'],
  [/灵分组/g, '未分组'],
  [/秉线/g, '在线'],
  [/在练/g, '在线'],
]

/** 职位别名 → 标准名（含轻度模糊） */
export const TITLE_ALIASES = [
  { canonical: '俱乐部之星', patterns: ['俱乐部之星', '佬乐部之星', '供乐部之星', '任乐部之星', '俱部之星'] },
  { canonical: '正式会员', patterns: ['正式会员', 'IE式会员', 'I式会员', '币式会员', '伟式会员', '正式会伟'] },
  { canonical: '候补会员', patterns: ['候补会员'] },
  { canonical: '外交官', patterns: ['外交官'] },
  { canonical: '副会长', patterns: ['副会长'] },
  { canonical: '会长', patterns: ['会长'] },
  { canonical: '骨干', patterns: ['骨干'] },
  { canonical: '成员', patterns: ['成员'] },
  { canonical: '候补', patterns: ['候补'] },
]

export const PATHWAY_ALIASES = [
  { canonical: '占卜家', patterns: ['占卜家', '占卜宾', '占卞家', '占下家'] },
  { canonical: '窥秘人', patterns: ['窥秘人', '窥秘入', '罕秘人'] },
  { canonical: '观众', patterns: ['观众', '观传'] },
  { canonical: '战士', patterns: ['战士', '战土'] },
  { canonical: '学徒', patterns: ['学徒', '学徙'] },
  { canonical: '猎人', patterns: ['猎人'] },
  { canonical: '刺客', patterns: ['刺客'] },
  { canonical: '僧侣', patterns: ['僧侣'] },
  { canonical: '律师', patterns: ['律师'] },
  { canonical: '读者', patterns: ['读者'] },
  { canonical: '窃贼', patterns: ['窃贼'] },
  { canonical: '水手', patterns: ['水手'] },
  { canonical: '歌手', patterns: ['歌手'] },
  { canonical: '农夫', patterns: ['农夫'] },
  { canonical: '工匠', patterns: ['工匠'] },
]

export function normalizeOcrText(text) {
  let s = String(text || '')
  for (const [re, to] of CHAR_FIXES) s = s.replace(re, to)
  return s
}

/** 去空白后的紧凑串再跑一遍归一 */
export function compactNormalize(text) {
  return normalizeOcrText(String(text || '').replace(/\s+/g, ''))
}
