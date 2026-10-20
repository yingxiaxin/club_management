export interface Member {
  id: string
  characterName: string
  powerScore: number
  fashionScore: number
  pathway: string
  title: string
  remark: string
  status: string
  joinedAt: string
  createdAt: string
  updatedAt: string
}

export type MemberInput = {
  characterName: string
  powerScore: number
  fashionScore: number
  pathway: string
  title: string
  remark?: string
}
