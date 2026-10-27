/** 瞬时网络故障（云 API / 外网下载常见） */
export function isTransientNetworkError(err) {
  const code = String(err?.code || '')
  const msg = String(err?.message || err || '')
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND'
  ) {
    return true
  }
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network|TLS|证书/i.test(msg)
}

export function humanizeNetworkError(err, what = '网络请求') {
  const raw = String(err?.message || err || '未知错误')
  if (isTransientNetworkError(err)) {
    return `${what}失败（连接被重置或超时）。请检查网络后重试；若持续失败可稍后再试。原文：${raw}`
  }
  return raw
}

export async function withRetries(fn, { retries = 3, delayMs = 400, label = 'request' } = {}) {
  let last
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn(i)
    } catch (err) {
      last = err
      if (!isTransientNetworkError(err) || i === retries - 1) throw err
      console.warn(`[ocr] ${label} 重试 ${i + 1}/${retries - 1}:`, err.message || err)
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw last
}
