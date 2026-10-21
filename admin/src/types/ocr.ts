export type OcrCandidate = {
  localId: string
  characterName: string
  title: string
  pathway: string
  powerScore: number
  fashionScore: number
  confidence: number
  lowConfidence: boolean
  issues: string[]
  action: 'create' | 'update'
  matchedMemberId: string | null
  selected: boolean
}

export type OcrParseResult = {
  jobId: string
  status: string
  candidates: OcrCandidate[]
  rawText?: string
  tip?: string
}

export type OcrCommitResult = {
  created: unknown[]
  updated: unknown[]
  skipped: { characterName: string; reason: string }[]
}
