<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteGalleryAlbum,
  deleteGalleryPost,
  fetchGallery,
  fetchGalleryAlbum,
  formatBytes,
  type GalleryAlbum,
  type GalleryImage,
  type GalleryStats,
} from '@/api/gallery'
import { fetchClubProfile, updateClubProfile } from '@/api/club'

const loading = ref(false)
const rows = ref<GalleryAlbum[]>([])
const stats = ref<GalleryStats>({ postCount: 0, usedBytes: 0, quotaBytes: 2147483648 })
const quotaGiB = ref(2)
const savingQuota = ref(false)

const detailVisible = ref(false)
const detail = ref<GalleryAlbum | null>(null)
const detailLoading = ref(false)
const withdrawing = ref(false)
const removingId = ref('')

const usedLabel = computed(() => formatBytes(stats.value.usedBytes))
const quotaLabel = computed(() => formatBytes(stats.value.quotaBytes))
const usagePct = computed(() => {
  const q = stats.value.quotaBytes || 1
  return Math.min(100, Math.round((stats.value.usedBytes / q) * 100))
})

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 年月日时分秒：YYYY-MM-DD HH:mm:ss */
function formatDateTime(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

/** 保证弹窗一定有 images[]，且每张带可展示 URL */
function normalizeAlbum(row: GalleryAlbum): GalleryAlbum {
  const albumId = row.albumId || row.id
  let images: GalleryImage[] = Array.isArray(row.images) ? row.images.slice() : []
  if (!images.length && (row.imageFileId || row.imageUrl || row.thumbUrl)) {
    images = [
      {
        id: row.id,
        imageFileId: row.imageFileId,
        thumbFileId: row.thumbFileId,
        byteSize: row.byteSize,
        createdAt: row.createdAt,
        imageUrl: row.imageUrl,
        thumbUrl: row.thumbUrl,
      },
    ]
  }
  images = images.map((img) => ({
    ...img,
    imageUrl: img.imageUrl || row.imageUrl || '',
    thumbUrl: img.thumbUrl || img.imageUrl || row.thumbUrl || row.imageUrl || '',
  }))
  return {
    ...row,
    id: albumId,
    albumId,
    images,
    imageCount: row.imageCount || images.length || 1,
  }
}

async function load() {
  loading.value = true
  try {
    const [data, club] = await Promise.all([
      fetchGallery(),
      fetchClubProfile().catch(() => null),
    ])
    rows.value = (data.list || []).map((r) => normalizeAlbum(r))
    stats.value = data.stats || stats.value
    if (club?.galleryStorageQuotaBytes) {
      quotaGiB.value = Math.max(0.1, club.galleryStorageQuotaBytes / (1024 * 1024 * 1024))
    } else {
      quotaGiB.value = stats.value.quotaBytes / (1024 * 1024 * 1024)
    }
    if (detail.value?.albumId) {
      const fresh = rows.value.find((r) => r.albumId === detail.value?.albumId)
      if (fresh) detail.value = fresh
      else {
        detail.value = null
        detailVisible.value = false
      }
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function saveQuota() {
  const gib = Number(quotaGiB.value)
  if (!Number.isFinite(gib) || gib < 0.001) {
    ElMessage.warning('请输入有效的容量上限（GiB）')
    return
  }
  savingQuota.value = true
  try {
    await updateClubProfile({
      galleryStorageQuotaBytes: Math.floor(gib * 1024 * 1024 * 1024),
    })
    ElMessage.success('已保存容量上限')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingQuota.value = false
  }
}

async function openDetail(row: GalleryAlbum) {
  detail.value = normalizeAlbum(row)
  detailVisible.value = true
  detailLoading.value = true
  try {
    const fresh = await fetchGalleryAlbum(row.albumId || row.id)
    detail.value = normalizeAlbum(fresh)
  } catch (e) {
    if (e instanceof Error && e.message) {
      ElMessage.warning(e.message)
    }
  } finally {
    detailLoading.value = false
  }
}

function imageSrc(img: GalleryImage) {
  return img.imageUrl || img.thumbUrl || ''
}

async function onWithdrawAlbum(album: GalleryAlbum | null | undefined) {
  if (!album || withdrawing.value) return
  try {
    await ElMessageBox.confirm(
      `确定撤回「${workTitle(album)}」（${album.characterName || '成员'}）？将删除全部图片且不可恢复。`,
      '撤回作品',
      { type: 'warning', confirmButtonText: '撤回', cancelButtonText: '取消' },
    )
    withdrawing.value = true
    await deleteGalleryAlbum(album.albumId)
    ElMessage.success('已撤回')
    if (detail.value?.albumId === album.albumId) {
      detailVisible.value = false
      detail.value = null
    }
    await load()
  } catch (e) {
    if (e === 'cancel') return
    if (e instanceof Error && e.message) ElMessage.error(e.message)
  } finally {
    withdrawing.value = false
  }
}

function onWithdraw() {
  return onWithdrawAlbum(detail.value)
}

function workTitle(row: GalleryAlbum | null | undefined) {
  const t = String(row?.caption || '').trim()
  return t || '未命名作品'
}

async function onRemoveImage(imageId: string) {
  if (!imageId || removingId.value) return
  const album = detail.value
  if (!album) return
  const onlyOne = (album.images?.length || 0) <= 1
  try {
    await ElMessageBox.confirm(
      onlyOne
        ? '这是最后一张图，删除后作品将一并撤回。确定？'
        : '仅删除这一张，其它图片保留。确定？',
      onlyOne ? '删除最后一张' : '删除图片',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    removingId.value = imageId
    await deleteGalleryPost(imageId)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e === 'cancel') return
    if (e instanceof Error && e.message) ElMessage.error(e.message)
  } finally {
    removingId.value = ''
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <div class="head">
      <h2 class="title">踏云寻芳</h2>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">作品数</div>
        <div class="stat-value">{{ stats.albumCount ?? rows.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">图片数</div>
        <div class="stat-value">{{ stats.postCount }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">已占用</div>
        <div class="stat-value">{{ usedLabel }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">容量上限</div>
        <div class="stat-value">{{ quotaLabel }}</div>
      </div>
      <div class="stat wide">
        <div class="stat-label">用量 {{ usagePct }}%</div>
        <el-progress :percentage="usagePct" :stroke-width="10" />
      </div>
    </div>

    <div class="quota-row">
      <span class="quota-label">调整容量上限（GiB）</span>
      <el-input-number v-model="quotaGiB" :min="0.1" :max="1024" :step="0.5" :precision="2" />
      <el-button type="primary" :loading="savingQuota" @click="saveQuota">保存上限</el-button>
    </div>

    <div class="table-wrap">
      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        empty-text="暂无作品"
        table-layout="fixed"
        height="100%"
        style="width: 100%"
      >
        <el-table-column label="预览" width="168">
          <template #default="{ row }">
            <button
              v-if="row.thumbUrl || row.imageUrl"
              type="button"
              class="preview-hit"
              title="查看作品详情"
              @click="openDetail(row)"
            >
              <div class="photo-stack">
                <span class="photo-stack-layer back2" aria-hidden="true" />
                <span class="photo-stack-layer back1" aria-hidden="true" />
                <img class="photo-stack-front" :src="row.thumbUrl || row.imageUrl" alt="" />
              </div>
            </button>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="题目" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ workTitle(row) }}</template>
        </el-table-column>
        <el-table-column prop="characterName" label="作者" min-width="100" width="140" show-overflow-tooltip />
        <el-table-column label="张数" width="72">
          <template #default="{ row }">{{ row.imageCount || row.images?.length || 1 }}</template>
        </el-table-column>
        <el-table-column label="赞" width="72">
          <template #default="{ row }">{{ row.likeCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ formatBytes(row.byteSize) }}</template>
        </el-table-column>
        <el-table-column label="时间" min-width="140" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" min-width="160" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button text type="danger" :loading="withdrawing" @click="onWithdrawAlbum(row)">
              撤回
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="detailVisible"
      title="作品详情"
      width="640px"
      destroy-on-close
      class="gallery-detail-dialog"
    >
      <template v-if="detail">
        <div class="detail-panel">
          <div class="detail-head">
            <div class="detail-meta">
              <div class="detail-title">{{ workTitle(detail) }}</div>
              <div class="detail-author">{{ detail.characterName || '成员' }}</div>
              <div class="detail-time muted">{{ formatDateTime(detail.createdAt) }}</div>
            </div>
            <button
              type="button"
              class="icon-action"
              :disabled="withdrawing"
              title="撤回作品"
              @click="onWithdraw"
            >
              <span class="icon-action-mark">↶</span>
              <span class="icon-action-label">撤回作品</span>
            </button>
          </div>

          <div v-loading="detailLoading" class="detail-images">
            <div
              v-for="img in detail.images"
              :key="img.id"
              class="detail-img-cell"
            >
              <el-image
                v-if="imageSrc(img)"
                class="detail-img"
                :src="imageSrc(img)"
                :preview-src-list="detail.images.map(imageSrc).filter(Boolean)"
                fit="cover"
              />
              <div v-else class="detail-img-empty muted">无预览</div>
              <button
                type="button"
                class="img-remove"
                :disabled="removingId === img.id"
                title="删除图片"
                @click="onRemoveImage(img.id)"
              >
                <span class="img-remove-mark">✕</span>
              </button>
            </div>
            <div v-if="!detail.images?.length && !detailLoading" class="muted">暂无图片</div>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: calc(100vh - var(--header-height) - 2 * var(--space-5));
  min-height: 360px;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-brand-hover);
}

.stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-3);
  flex-shrink: 0;
}

.stat {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.stat.wide {
  grid-column: span 1;
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-2);
}

.stat-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}

.quota-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.table-wrap {
  flex: 1;
  min-height: 160px;
  overflow: hidden;
}

.quota-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.preview-hit {
  display: inline-block;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.preview-hit:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}

.photo-stack {
  position: relative;
  width: 112px;
  height: 84px;
  margin: 6px 4px 6px 2px;
  padding-right: 6px;
  box-sizing: border-box;
}

.photo-stack-layer {
  position: absolute;
  left: 2px;
  right: 8px;
  top: 4px;
  bottom: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-elevated);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  transform-origin: left center;
}

.photo-stack-layer.back2 {
  transform: rotate(3.5deg) translate(4px, 2px);
  opacity: 0.5;
  background: var(--color-brand-muted);
}

.photo-stack-layer.back1 {
  transform: rotate(1.8deg) translate(2px, 1px);
  opacity: 0.72;
}

.photo-stack-front {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
  background: var(--color-surface-elevated);
  display: block;
}

.muted {
  color: var(--color-text-muted);
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.detail-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.detail-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-brand);
  line-height: 1.4;
  white-space: pre-wrap;
}

.detail-author {
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.detail-time {
  font-size: var(--font-size-xs);
}

.icon-action {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 72px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  color: inherit;
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  background: var(--color-brand-muted);
  border-color: var(--color-border-strong);
}

.icon-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-action-mark {
  font-size: 20px;
  line-height: 1.2;
  color: var(--color-brand);
}

.icon-action-label {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.2;
}

.detail-images {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.detail-img-cell {
  position: relative;
  width: calc((100% - var(--space-3)) / 2);
  min-height: 180px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  overflow: hidden;
  background: var(--color-surface);
  aspect-ratio: 1;
}

.detail-img {
  width: 100%;
  height: 100%;
  display: block;
}

.detail-img :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-img-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 180px;
  font-size: var(--font-size-sm);
}

.img-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--color-border-strong);
  background: rgba(0, 0, 0, 0.62);
  color: inherit;
  cursor: pointer;
}

.img-remove:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.82);
}

.img-remove:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.img-remove-mark {
  font-size: 14px;
  line-height: 1;
  color: var(--color-brand);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
