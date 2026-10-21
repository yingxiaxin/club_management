/**
 * 可选：腾讯云通用印刷体识别（高精度更佳）。
 * 环境变量：
 *   TENCENTCLOUD_SECRET_ID
 *   TENCENTCLOUD_SECRET_KEY
 *   TENCENTCLOUD_OCR_REGION（默认 ap-guangzhou）
 *   TENCENTCLOUD_OCR_ACTION = GeneralBasicOCR | GeneralAccurateOCR（默认 GeneralBasicOCR）
 */

export function isTencentOcrConfigured() {
  return Boolean(process.env.TENCENTCLOUD_SECRET_ID && process.env.TENCENTCLOUD_SECRET_KEY)
}

export async function recognizeWithTencent(imageBuffer) {
  if (!isTencentOcrConfigured()) {
    throw Object.assign(new Error('未配置腾讯云 OCR 密钥'), { status: 400 })
  }

  let OcrClient
  try {
    const mod = await import('tencentcloud-sdk-nodejs-ocr')
    OcrClient = mod.ocr.v20181119.Client
  } catch {
    throw Object.assign(
      new Error('未安装 tencentcloud-sdk-nodejs-ocr，请在 cloud/dev-server 执行 npm i tencentcloud-sdk-nodejs-ocr'),
      { status: 500 },
    )
  }

  const client = new OcrClient({
    credential: {
      secretId: process.env.TENCENTCLOUD_SECRET_ID,
      secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
    },
    region: process.env.TENCENTCLOUD_OCR_REGION || 'ap-guangzhou',
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: { reqMethod: 'POST', reqTimeout: 60 },
    },
  })

  const action = process.env.TENCENTCLOUD_OCR_ACTION || 'GeneralBasicOCR'
  const ImageBase64 = imageBuffer.toString('base64')
  const params = { ImageBase64, LanguageType: 'zh' }

  const data =
    action === 'GeneralAccurateOCR'
      ? await client.GeneralAccurateOCR(params)
      : await client.GeneralBasicOCR(params)

  const lines = (data.TextDetections || [])
    .slice()
    .sort((a, b) => {
      const ay = a.Polygon?.[0]?.Y ?? a.ItemPolygon?.Y ?? 0
      const by = b.Polygon?.[0]?.Y ?? b.ItemPolygon?.Y ?? 0
      if (Math.abs(ay - by) > 12) return ay - by
      const ax = a.Polygon?.[0]?.X ?? a.ItemPolygon?.X ?? 0
      const bx = b.Polygon?.[0]?.X ?? b.ItemPolygon?.X ?? 0
      return ax - bx
    })
    .map((d) => d.DetectedText || '')
    .filter(Boolean)

  return {
    rawText: lines.join('\n'),
    provider: action,
  }
}
