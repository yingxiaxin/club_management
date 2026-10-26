import http from './http'

export interface GalleryPost {
  id: string
  memberId: string
  characterName: string
  imageFileId: string
  thumbFileId?: string | null
  byteSize: number
  caption: string
  status: string
  createdAt?: string | null
  updatedAt?: string | null
  thumbUrl?: string
  imageUrl?: string
}

export interface GalleryStats {
  postCount: number
  usedBytes: number
  quotaBytes: number
}

export interface GalleryListPayload {
  list: GalleryPost[]
  stats: GalleryStats
}

async function unwrap<T>(p: Promise<{ data: { ok: boolean; data?: T; message?: string } }>) {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data as T
}

export function fetchGallery() {
  return unwrap<GalleryListPayload>(http.get('/api/gallery'))
}

export function deleteGalleryPost(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(http.delete(`/api/gallery/${id}`))
}

export function formatBytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
