<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteGalleryPost,
  fetchGallery,
  formatBytes,
  type GalleryPost,
  type GalleryStats,
} from '@/api/gallery'
import { fetchClubProfile, updateClubProfile } from '@/api/club'

const loading = ref(false)
const rows = ref<GalleryPost[]>([])
const stats = ref<GalleryStats>({ postCount: 0, usedBytes: 0, quotaBytes: 2147483648 })
const quotaGiB = ref(2)
const savingQuota = ref(false)

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

async function load() {
  loading.value = true
  try {
    const [data, club] = await Promise.all([
      fetchGallery(),
      fetchClubProfile().catch(() => null),
    ])
    rows.value = data.list || []
    stats.value = data.stats || stats.value
    if (club?.galleryStorageQuotaBytes) {
      quotaGiB.value = Math.max(0.1, club.galleryStorageQuotaBytes / (1024 * 1024 * 1024))
    } else {
      quotaGiB.value = stats.value.quotaBytes / (1024 * 1024 * 1024)
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

async function onDelete(row: GalleryPost) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.characterName || '成员'}」的作品？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await deleteGalleryPost(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e === 'cancel') return
    if (e instanceof Error && e.message) ElMessage.error(e.message)
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

    <el-table v-loading="loading" :data="rows" stripe empty-text="暂无作品">
      <el-table-column label="预览" width="300">
        <template #default="{ row }">
          <div v-if="row.thumbUrl || row.imageUrl" class="photo-stack">
            <span class="photo-stack-layer back2" aria-hidden="true" />
            <span class="photo-stack-layer back1" aria-hidden="true" />
            <img class="photo-stack-front" :src="row.thumbUrl || row.imageUrl" alt="" />
          </div>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="characterName" label="作者" min-width="150" width="200" show-overflow-tooltip />
      <el-table-column prop="caption" label="简介" min-width="120" show-overflow-tooltip />
      <el-table-column label="大小" width="150">
        <template #default="{ row }">{{ formatBytes(row.byteSize) }}</template>
      </el-table-column>
      <el-table-column label="时间" min-width="150" width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button type="danger" link @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-brand-hover);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
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
}

.quota-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.photo-stack {
  position: relative;
  width: 128px;
  height: 100px;
  margin: 8px 8px 8px 4px;
  padding-right: 12px;
  box-sizing: border-box;
}

.photo-stack-layer {
  position: absolute;
  left: 4px;
  right: 16px;
  top: 6px;
  bottom: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-elevated);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
  transform-origin: left center;
}

/* 底层只向右侧错开 */
.photo-stack-layer.back2 {
  transform: rotate(8deg) translate(10px, 4px);
  opacity: 0.5;
  background: var(--color-brand-muted);
}

.photo-stack-layer.back1 {
  transform: rotate(4deg) translate(5px, 2px);
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
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  background: var(--color-surface-elevated);
  display: block;
}

.muted {
  color: var(--color-text-muted);
}

@media (max-width: 960px) {
  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
