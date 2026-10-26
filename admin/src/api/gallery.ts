import http from './http'

export interface GalleryImage {
  id: string
  imageFileId: string
  thumbFileId?: string | null
  byteSize: number
  createdAt?: string | null
  thumbUrl?: string
  imageUrl?: string
}

/** 作品（同 albumId 聚合；旧数据无 albumId 时以单帖 id 为作品） */
export interface GalleryAlbum {
  id: string
  albumId: string
  memberId: string
  characterName: string
  caption: string
  status?: string
  createdAt?: string | null
  updatedAt?: string | null
  imageCount: number
  byteSize: number
  likeCount?: number
  imageFileId: string
  thumbFileId?: string | null
  thumbUrl?: string
  imageUrl?: string
  images: GalleryImage[]
}

/** @deprecated 兼容旧名 */
export type GalleryPost = GalleryAlbum

export interface GalleryStats {
  postCount: number
  albumCount?: number
  usedBytes: number
  quotaBytes: number
}

export interface GalleryListPayload {
  list: GalleryAlbum[]
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

export function fetchGalleryAlbum(id: string) {
  return unwrap<GalleryAlbum>(http.get(`/api/gallery/${encodeURIComponent(id)}`))
}

/** 删除单张图片 */
export function deleteGalleryPost(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(http.delete(`/api/gallery/${encodeURIComponent(id)}`))
}

/** 撤回整部作品 */
export function deleteGalleryAlbum(albumId: string) {
  return unwrap<{ albumId: string; deleted: boolean; images: number }>(
    http.delete(`/api/gallery/albums/${encodeURIComponent(albumId)}`),
  )
}

export function formatBytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
