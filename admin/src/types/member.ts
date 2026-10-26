/** 后台账号角色（来自 users）；未关联微信时为 null */
export type AccountRole = 'super_admin' | 'admin' | 'member' | 'guest' | null

export interface Member {
  id: string
  characterName: string
  level: number
  powerScore: number
  fashionScore: number
  pathway: string
  title: string
  remark: string
  status: string
  joinedAt: string
  createdAt: string
  updatedAt: string
  boundOpenid?: string | null
  /** 列表接口附带：users.role；无绑定或无 users 行为 null */
  accountRole?: AccountRole
  /** 手录新增时若命中已移出同名档案并恢复，接口临时带回；不落库 */
  restoredFromLeft?: boolean
}

export type MemberInput = {
  characterName: string
  level?: number
  powerScore: number
  fashionScore: number
  pathway: string
  title: string
  remark?: string
}
