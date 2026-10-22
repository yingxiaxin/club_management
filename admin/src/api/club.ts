import http from './http'

export type MiniprogramState = 'developer' | 'trial' | 'formal'

export interface ClubProfile {
  id: string
  name: string
  iconUrl: string
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
