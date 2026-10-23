<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type UploadRequestOptions } from 'element-plus'
import { fetchClubProfile, updateClubProfile, uploadClubIcon } from '@/api/club'

const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const form = reactive({
  name: '',
  iconUrl: '',
  iconDisplayUrl: '',
  intro: '',
})

const previewSrc = computed(() => form.iconDisplayUrl || form.iconUrl)

function applyProfile(row: {
  name?: string
  iconUrl?: string
  iconDisplayUrl?: string
  intro?: string
}) {
  form.name = row.name || ''
  form.iconUrl = row.iconUrl || ''
  form.iconDisplayUrl = row.iconDisplayUrl || ''
  form.intro = row.intro || ''
}

async function load() {
  loading.value = true
  try {
    applyProfile(await fetchClubProfile())
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function onSave() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写俱乐部名称')
    return
  }
  saving.value = true
  try {
    applyProfile(
      await updateClubProfile({
        name: form.name.trim(),
        iconUrl: form.iconUrl.trim(),
        intro: form.intro.trim(),
      }),
    )
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function onUpload(options: UploadRequestOptions) {
  const raw = options.file as File
  if (!raw) {
    options.onError?.(new Error('无文件') as never)
    return
  }
  uploading.value = true
  try {
    applyProfile(await uploadClubIcon(raw))
    ElMessage.success('图标已上传并保存')
    options.onSuccess?.({})
  } catch (e) {
    const err = e instanceof Error ? e : new Error('上传失败')
    ElMessage.error(err.message)
    options.onError?.(err as never)
  } finally {
    uploading.value = false
  }
}

function beforeUpload(file: File) {
  const okType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
  if (!okType) {
    ElMessage.warning('仅支持 PNG / JPG / WebP / GIF')
    return false
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('图标不能超过 10MB')
    return false
  }
  return true
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="head">
      <h1>俱乐部资料设置</h1>
      <p class="sub">名称、图标与简介会显示在小程序首页。提醒模板仍在「提醒设置」。</p>
    </div>

    <el-form class="form" label-width="100px" @submit.prevent="onSave">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" maxlength="64" show-word-limit style="max-width: 420px" />
      </el-form-item>

      <el-form-item label="图标">
        <div class="icon-block">
          <div v-if="previewSrc" class="preview">
            <img :src="previewSrc" alt="俱乐部图标预览" />
          </div>
          <div v-else class="preview empty">无图标</div>
          <div class="icon-actions">
            <el-upload
              :show-file-list="false"
              accept="image/png,image/jpeg,image/webp,image/gif"
              :http-request="onUpload"
              :before-upload="beforeUpload"
              :disabled="uploading || saving"
            >
              <el-button type="primary" plain :loading="uploading">本地上传</el-button>
            </el-upload>
            <el-input
              v-model="form.iconUrl"
              placeholder="也可粘贴 https://… 或 cloud://…（保存后生效）"
              style="max-width: 420px"
            />
            <p class="tip">本地上传会保存到云存储并立即写入资料；小程序可直接显示 cloud:// 地址。</p>
          </div>
        </div>
      </el-form-item>

      <el-form-item label="简介">
        <el-input
          v-model="form.intro"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          placeholder="一句话介绍俱乐部，显示在小程序首页名称下方"
          style="max-width: 520px"
        />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        <el-button :disabled="loading || saving || uploading" @click="load">重新加载</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
}

.head {
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

.tip {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.45;
}

.icon-block {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.icon-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.preview {
  width: 88px;
  height: 88px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  overflow: hidden;
  background: var(--color-surface);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview.empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
