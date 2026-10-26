/**
 * 踏云寻芳：选图 → 限长边缩放 → JPEG 压缩（主图/缩略）→ 上传云存储
 *
 * 游戏截图往往分辨率很大；仅 compressImage 不够，须先缩边再压质量。
 */

const MAX_PICK = 9
/** 主图最长边（像素）；更大则等比缩小 */
const FULL_MAX_EDGE = 1920
/** 缩略图最长边 */
const THUMB_MAX_EDGE = 480
/** JPEG 质量 0–100（wx.compressImage） */
const FULL_QUALITY = 72
const THUMB_QUALITY = 48
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'])

function fsStatSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (res) => resolve(Number(res.size) || 0),
      fail: reject,
    })
  })
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject,
    })
  })
}

function compress(src, quality) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality,
      success: (res) => resolve(res.tempFilePath || src),
      fail: reject,
    })
  })
}

function uploadCloud(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (!res.fileID) reject(new Error('上传失败'))
        else resolve(res.fileID)
      },
      fail: (e) => reject(new Error(e.errMsg || '上传失败')),
    })
  })
}

function isImageFile(file) {
  if (!file) return false
  const ft = String(file.fileType || file.type || '').toLowerCase()
  if (ft === 'image' || ft.startsWith('image/')) return true
  const path = String(file.tempFilePath || file.path || '')
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTS.has(ext)) return true
  return Boolean(file.tempFilePath) && !ft
}

function calcTargetSize(width, height, maxEdge) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const edge = Math.max(w, h)
  if (!edge || edge <= maxEdge) return { tw: w, th: h, scaled: false }
  const scale = maxEdge / edge
  return {
    tw: Math.max(1, Math.round(w * scale)),
    th: Math.max(1, Math.round(h * scale)),
    scaled: true,
  }
}

/**
 * 等比缩放到最长边 ≤ maxEdge，并导出 JPEG。
 * 优先 OffscreenCanvas；失败则退回原图路径（再交给 compressImage）。
 */
async function resizeToJpeg(src, maxEdge, quality01) {
  const info = await getImageInfo(src)
  const { tw, th, scaled } = calcTargetSize(info.width, info.height, maxEdge)
  if (!scaled || !tw || !th) return src

  if (typeof wx.createOffscreenCanvas !== 'function') {
    return src
  }

  const canvas = wx.createOffscreenCanvas({ type: '2d', width: tw, height: th })
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.createImage !== 'function') return src

  const img = canvas.createImage()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('读图失败'))
    img.src = src
  })
  ctx.clearRect(0, 0, tw, th)
  ctx.drawImage(img, 0, 0, tw, th)

  const tempPath = await new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: tw,
      height: th,
      destWidth: tw,
      destHeight: th,
      fileType: 'jpg',
      quality: quality01,
      success: (res) => resolve(res.tempFilePath),
      fail: reject,
    })
  })
  return tempPath || src
}

/**
 * 限边缩放 + 质量压缩；任一步失败则尽量用上一步结果。
 */
async function prepareImage(src, maxEdge, jpegQuality) {
  let path = src
  try {
    path = await resizeToJpeg(src, maxEdge, Math.min(1, Math.max(0.4, jpegQuality / 100)))
  } catch {
    path = src
  }
  try {
    path = await compress(path, jpegQuality)
  } catch {
    /* 保留缩放结果或原图 */
  }
  return path
}

/**
 * @param {string} memberId
 * @param {string} src
 * @returns {Promise<{ imageFileId: string, thumbFileId: string, byteSize: number, localPath: string }>}
 */
async function compressAndUploadOne(memberId, src) {
  const mid = String(memberId || '').trim() || 'anon'
  const [fullPath, thumbPath] = await Promise.all([
    prepareImage(src, FULL_MAX_EDGE, FULL_QUALITY),
    prepareImage(src, THUMB_MAX_EDGE, THUMB_QUALITY),
  ])

  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const base = `gallery/${mid}/${ts}-${rand}`
  const [imageFileId, thumbFileId, fullSize, thumbSize] = await Promise.all([
    uploadCloud(`${base}-full.jpg`, fullPath),
    uploadCloud(`${base}-thumb.jpg`, thumbPath),
    fsStatSize(fullPath),
    fsStatSize(thumbPath),
  ])
  const byteSize = fullSize + thumbSize
  if (byteSize > 8 * 1024 * 1024) {
    throw new Error('有图片过大，请换一张或再压缩')
  }
  return { imageFileId, thumbFileId, byteSize, localPath: src }
}

/**
 * @param {string} memberId
 * @param {{ remain?: number }} [opts] remain 还可再选几张（默认 9）
 * @returns {Promise<Array<{ imageFileId: string, thumbFileId: string, byteSize: number, localPath: string }>>}
 */
async function pickCompressAndUploadMany(memberId, opts = {}) {
  const remain = Math.min(
    MAX_PICK,
    Math.max(1, Number(opts.remain) > 0 ? Math.floor(Number(opts.remain)) : MAX_PICK),
  )
  const choose = await new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: resolve,
      fail: (e) => reject(new Error(e.errMsg || '未选择图片')),
    })
  })
  const files = (choose.tempFiles || []).filter(isImageFile)
  if (!files.length) throw new Error('请选择图片（仅支持图片格式）')

  const out = []
  for (let i = 0; i < files.length; i++) {
    const src = files[i].tempFilePath
    if (!src) continue
    out.push(await compressAndUploadOne(memberId, src))
  }
  if (!out.length) throw new Error('没有可上传的图片')
  return out
}

module.exports = {
  MAX_PICK,
  FULL_MAX_EDGE,
  THUMB_MAX_EDGE,
  pickCompressAndUploadMany,
  compressAndUploadOne,
}
