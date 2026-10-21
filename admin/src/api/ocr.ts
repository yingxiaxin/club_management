import http from './http'
import type { OcrCommitResult, OcrParseResult } from '@/types/ocr'

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; message: string; data?: unknown }

async function unwrap<T>(p: Promise<{ data: ApiOk<T> | ApiErr }>): Promise<T> {
  const { data } = await p
  if (!data.ok) throw new Error(data.message || '请求失败')
  return data.data
}

export function parseOcrImages(files: File[]) {
  const form = new FormData()
  for (const f of files) form.append('images', f)
  return unwrap(
    http.post('/api/ocr/parse', form, {
      timeout: 180000,
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as Promise<{ data: ApiOk<OcrParseResult> | ApiErr }>,
  )
}

export function commitOcrImport(
  jobId: string,
  rows: Array<{
    characterName: string
    title: string
    pathway: string
    powerScore: number
    fashionScore: number
    selected: boolean
    remark?: string
  }>,
) {
  return unwrap(
    http.post('/api/ocr/commit', { jobId, rows }) as Promise<{
      data: ApiOk<OcrCommitResult> | ApiErr
    }>,
  )
}
