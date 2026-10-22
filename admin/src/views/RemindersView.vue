<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchClubProfile,
  updateClubProfile,
  type MiniprogramState,
} from '@/api/club'

const OFFSET_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
]

const loading = ref(false)
const saving = ref(false)
const form = reactive({
  name: '',
  reminderOffsetsMinutes: [10] as number[],
  subscribeTemplateId: '',
  subscribeMiniprogramState: 'developer' as MiniprogramState,
})

async function load() {
  loading.value = true
  try {
    const row = await fetchClubProfile()
    form.name = row.name || ''
    form.reminderOffsetsMinutes = row.reminderOffsetsMinutes?.length
      ? [...row.reminderOffsetsMinutes]
      : [10]
    form.subscribeTemplateId = row.subscribeTemplateId || ''
    form.subscribeMiniprogramState = row.subscribeMiniprogramState || 'developer'
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function onSave() {
  if (!form.reminderOffsetsMinutes.length) {
    ElMessage.warning('请至少选择一个默认提前量')
    return
  }
  saving.value = true
  try {
    await updateClubProfile({
      name: form.name.trim() || undefined,
      reminderOffsetsMinutes: form.reminderOffsetsMinutes,
      subscribeTemplateId: form.subscribeTemplateId.trim(),
      subscribeMiniprogramState: form.subscribeMiniprogramState,
    })
    ElMessage.success('已保存')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="head">
      <h1>提醒设置</h1>
      <p class="sub">
        配置俱乐部默认提醒提前量与订阅消息模板。单个活动仍可在「活动日程」里覆盖提前量与周期。
      </p>
    </div>

    <el-form class="form" label-width="140px" @submit.prevent="onSave">
      <el-form-item label="俱乐部名称">
        <el-input v-model="form.name" maxlength="64" show-word-limit style="max-width: 420px" />
      </el-form-item>

      <el-form-item label="默认提前量" required>
        <el-checkbox-group v-model="form.reminderOffsetsMinutes">
          <el-checkbox
            v-for="opt in OFFSET_OPTIONS"
            :key="opt.value"
            :label="opt.value"
          >
            {{ opt.label }}
          </el-checkbox>
        </el-checkbox-group>
        <p class="tip">产品默认 10 分钟；可多选。活动未单独配置时，调度会回落到此处。</p>
      </el-form-item>

      <el-form-item label="订阅消息模板 ID">
        <el-input
          v-model="form.subscribeTemplateId"
          placeholder="微信公众平台 → 订阅消息 → 模板 ID"
          style="max-width: 520px"
        />
        <p class="tip">
          未配置时，成员仍可点「提醒我」记账，但定时任务不会真正下发。建议选用含「活动名称 /
          时间 / 备注」类字段的模板；发送字段默认 thing1 / time2 / thing3。
        </p>
      </el-form-item>

      <el-form-item label="下发环境">
        <el-radio-group v-model="form.subscribeMiniprogramState">
          <el-radio label="developer">开发版</el-radio>
          <el-radio label="trial">体验版</el-radio>
          <el-radio label="formal">正式版</el-radio>
        </el-radio-group>
        <p class="tip">联调阶段用开发版；正式发版后改为正式版。</p>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        <el-button :disabled="loading || saving" @click="load">重新加载</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 860px;
}

.head h1 {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

.sub {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.form {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.tip {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  max-width: 560px;
}
</style>
