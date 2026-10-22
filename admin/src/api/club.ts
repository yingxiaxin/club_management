import http from './http'

export type MiniprogramState = 'developer' | 'trial' | 'formal'

export interface ClubProfile {
  id: string
  name: string
  iconUrl: string
  /** 管理端预览用（cloud:// 已换临时 HTTPS） */
  iconDisplayUrl?: string
  intro: string
  reminderOffsetsMinutes: number[]
  subscribeTemplateId: string
  subscribeMiniprogramState: MiniprogramState
  updatedAt?: string | null
  updatedBy?: string | null
}

export async function fetchClubProfile(): Promise<ClubProfile> {
  const { data } = await http.get<{ ok: boolean; data: ClubProfile; message?: string }>(
    '/api/club-profile',
  )
  if (!data.ok) throw new Error(data.message || '加载失败')
  return data.data
}

export async function updateClubProfile(
  body: Partial<
    Pick<
      ClubProfile,
      | 'name'
      | 'iconUrl'
      | 'intro'
      | 'reminderOffsetsMinutes'
      | 'subscribeTemplateId'
      | 'subscribeMiniprogramState'
    >
  >,
): Promise<ClubProfile> {
  const { data } = await http.put<{ ok: boolean; data: ClubProfile; message?: string }>(
    '/api/club-profile',
    body,
  )
  if (!data.ok) throw new Error(data.message || '保存失败')
  return data.data
}

/** 本地上传图标到云存储，并写入 club_profile.iconUrl */
export async function uploadClubIcon(file: File | Blob): Promise<ClubProfile> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<{ ok: boolean; data: ClubProfile; message?: string }>(
    '/api/club-profile/icon',
    form,
    { timeout: 60000 },
  )
  if (!data.ok) throw new Error(data.message || '上传失败')
  return data.data
}
