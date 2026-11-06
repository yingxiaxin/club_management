<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import http from '@/api/http'

const src = ref('')
const error = ref('')
const loading = ref(true)
let blobUrl = ''

onMounted(async () => {
  try {
    const res = await http.get('/api/manual', { responseType: 'text', timeout: 60_000 })
    const html = typeof res.data === 'string' ? res.data : ''
    if (!html.includes('<html')) {
      error.value = '使用手册内容异常'
      return
    }
    blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    src.value = blobUrl
  } catch (e) {
    error.value = e instanceof Error ? e.message : '使用手册加载失败'
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (blobUrl) URL.revokeObjectURL(blobUrl)
})
</script>

<template>
  <p v-if="loading" class="manual-status">正在打开使用手册…</p>
  <p v-else-if="error" class="manual-status">{{ error }}</p>
  <iframe v-else class="manual-frame" title="使用手册" :src="src"></iframe>
</template>

<style scoped>
.manual-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
  background: var(--color-bg);
}

.manual-status {
  margin: var(--space-5);
  color: var(--color-text-muted);
}
</style>
