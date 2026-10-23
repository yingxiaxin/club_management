<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
  type Announcement,
} from '@/api/announcements'

const loading = ref(false)
const saving = ref(false)
const rows = ref<Announcement[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  title: '',
  content: '',
  pinned: false,
})

function resetForm() {
  editingId.value = null
  form.title = ''
  form.content = ''
  form.pinned = false
}

async function load() {
  loading.value = true
  try {
    rows.value = await fetchAnnouncements()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  resetForm()
  dialogOpen.value = true
}

function openEdit(row: Announcement) {
  editingId.value = row.id
  form.title = row.title
  form.content = row.content
  form.pinned = row.pinned
  dialogOpen.value = true
}

async function onSubmit() {
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning('请填写标题与正文')
    return
  }
  saving.value = true
  try {
    const body = {
      title: form.title.trim(),
      content: form.content.trim(),
      pinned: form.pinned,
    }
    if (editingId.value) {
      await updateAnnouncement(editingId.value, body)
      ElMessage.success('已更新')
    } else {
      await createAnnouncement(body)
      ElMessage.success('已发布')
    }
    dialogOpen.value = false
    resetForm()
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function togglePin(row: Announcement) {
  try {
    await updateAnnouncement(row.id, { pinned: !row.pinned })
    ElMessage.success(row.pinned ? '已取消置顶' : '已置顶')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

async function onDelete(row: Announcement) {
  try {
    await ElMessageBox.confirm(`确定删除公告「${row.title}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteAnnouncement(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

function formatTime(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <header class="head">
      <div>
        <h1>公告发布</h1>
        <p class="sub">置顶优先展示在小程序首页；成员绑定后可见。</p>
      </div>
      <el-button type="primary" @click="openCreate">发布公告</el-button>
    </header>

    <el-table :data="rows" stripe empty-text="暂无公告">
      <el-table-column label="标题" min-width="180">
        <template #default="{ row }">
          <span class="title">{{ row.title }}</span>
          <span v-if="row.pinned" class="pin">置顶</span>
        </template>
      </el-table-column>
      <el-table-column label="正文" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content }}</template>
      </el-table-column>
      <el-table-column label="发布时间" width="170">
        <template #default="{ row }">{{ formatTime(row.publishedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button text type="primary" @click="togglePin(row)">
            {{ row.pinned ? '取消置顶' : '置顶' }}
          </el-button>
          <el-button text type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogOpen"
      :title="editingId ? '编辑公告' : '发布公告'"
      width="560px"
      destroy-on-close
    >
      <el-form label-width="80px" @submit.prevent="onSubmit">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="80" show-word-limit />
        </el-form-item>
        <el-form-item label="正文" required>
          <el-input v-model="form.content" type="textarea" :rows="8" maxlength="4000" show-word-limit />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.pinned" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">
          {{ editingId ? '保存' : '发布' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

.sub {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.title {
  color: var(--color-text);
  font-weight: 600;
}

.pin {
  margin-left: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-brand);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-sm);
  padding: 0 6px;
  vertical-align: middle;
}
</style>
