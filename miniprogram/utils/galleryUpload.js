/**
 * 踏云寻芳：选图（仅图片，最多 9 张）→ 压缩主图/缩略 → 上传云存储
 */

const MAX_PICK = 9
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
  // chooseMedia 选图时往往无扩展名，有 tempFilePath 即视为通过 mediaType 约束
  return Boolean(file.tempFilePath) && !ft
}

/**
 * @param {string} memberId
 * @param {string} src
 * @returns {Promise<{ imageFileId: string, thumbFileId: string, byteSize: number, localPath: string }>}
 */
async function compressAndUploadOne(memberId, src) {
  const mid = String(memberId || '').trim() || 'anon'
  let fullPath = src
  let thumbPath = src
  try {
    fullPath = await compress(src, 72)
  } catch {
    /* 压缩失败用原图 */
  }
  try {
    thumbPath = await compress(src, 40)
  } catch {
    thumbPath = fullPath
  }

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
  pickCompressAndUploadMany,
  compressAndUploadOne,
}
