<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createActivity,
  exportActivityRsvpsCsv,
  fetchActivities,
  fetchActivityRsvpOccurrences,
  transitionActivity,
  updateActivity,
  type Activity,
  type ActivityStatus,
  type ActivityType,
  type ReminderCycle,
  type RsvpOccurrenceOption,
  type ScheduleParts,
} from '@/api/activities'

const TYPE_LABEL: Record<ActivityType, string> = {
  daily: '日常',
  weekly: '周本',
  pvp: 'PVP',
  custom: '自定义',
}

const STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: '草稿',
  published: '已发布',
  ongoing: '进行中',
  ended: '已结束',
  cancelled: '已取消',
}

const CYCLE_LABEL: Record<ReminderCycle, string> = {
  none: '不提醒',
  once: '一次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const loading = ref(false)
const activities = ref<Activity[]>([])
const statusFilter = ref<'all' | ActivityStatus>('published')

const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
/** 打开新建/编辑时跳过「开始→结束」联动，避免覆盖已有结束时间 */
const skipEndSync = ref(false)
const END_OFFSET_MINUTES = 30

function emptySchedule(): ScheduleParts {
  return { year: null, month: null, day: null, weekday: null, time: null }
}

/** 结束默认 = 开始的年月日星期 + 时间后推 N 分钟（跨日则顺延日/星期） */
function endFromStart(start: ScheduleParts, offsetMinutes: number): ScheduleParts {
  const end: ScheduleParts = {
    year: start.year,
    month: start.month,
    day: start.day,
    weekday: start.weekday,
    time: null,
  }
  if (!start.time) return end

  const [hRaw, mRaw] = start.time.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    end.time = start.time
    return end
  }

  let total = h * 60 + m + offsetMinutes
  const dayBump = Math.floor(total / (24 * 60))
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  end.time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

  if (dayBump === 0) return end

  if (end.year != null && end.month != null && end.day != null) {
    const d = new Date(end.year, end.month - 1, end.day)
    d.setDate(d.getDate() + dayBump)
    end.year = d.getFullYear()
    end.month = d.getMonth() + 1
    end.day = d.getDate()
    const wd = d.getDay()
    end.weekday = wd === 0 ? 7 : wd
  } else {
    if (end.day != null) end.day = end.day + dayBump
    if (end.weekday != null) {
      end.weekday = ((end.weekday - 1 + dayBump) % 7) + 1
    }
  }
  return end
}

function syncEndFromStart() {
  if (skipEndSync.value || !dialogOpen.value) return
  Object.assign(form.end, endFromStart(form.start, END_OFFSET_MINUTES))
}

/** 本机当前：仅年月日 + 星期（1=周一…7=周日），不含时间 */
function todayDateParts(): Pick<ScheduleParts, 'year' | 'month' | 'day' | 'weekday'> {
  const d = new Date()
  const wd = d.getDay()
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: wd === 0 ? 7 : wd,
  }
}

/** 开始：写入今天的年月日星期，保留已选时间；并联动结束 */
function fillStartToday() {
  const parts = todayDateParts()
  form.start.year = parts.year
  form.start.month = parts.month
  form.start.day = parts.day
  form.start.weekday = parts.weekday
  syncEndFromStart()
}

/** 结束：仅写入今天的年月日星期，保留已选时间（不触发开始联动） */
function fillEndToday() {
  const parts = todayDateParts()
  form.end.year = parts.year
  form.end.month = parts.month
  form.end.day = parts.day
  form.end.weekday = parts.weekday
}

function withSkipEndSync(fn: () => void) {
  skipEndSync.value = true
  try {
    fn()
  } finally {
    nextTick(() => {
      skipEndSync.value = false
    })
  }
}

const form = reactive({
  title: '',
  type: 'daily' as ActivityType,
  start: emptySchedule(),
  end: emptySchedule(),
  description: '',
  enableTeam: true,
  enableReminder: true,
  publishNow: true,
})

const yearOptions = computed(() => {
  const y = new Date().getFullYear()
  const set = new Set<number>()
  for (let i = y - 1; i <= y + 3; i++) set.add(i)
  if (form.start.year != null) set.add(form.start.year)
  if (form.end.year != null) set.add(form.end.year)
  return [...set].sort((a, b) => a - b)
})

const filteredActivities = computed(() => {
  if (statusFilter.value === 'all') return activities.value
  return activities.value.filter((a) => a.status === statusFilter.value)
})

/** 开启提醒时按开始分量自动选周期（提前量跟俱乐部设置） */
function preferredReminderCycle(s: ScheduleParts): ReminderCycle {
  if (!s.time) return 'none'
  const full = s.year != null && s.month != null && s.day != null
  if (full) return 'once'
  if (s.weekday != null) return 'weekly'
  if (s.day != null) return 'daily'
  return 'daily'
}

watch(
  () => [
    form.start.year,
    form.start.month,
    form.start.day,
    form.start.weekday,
    form.start.time,
  ],
  syncEndFromStart,
)

async function load() {
  loading.value = true
  try {
    activities.value = await fetchActivities()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function scheduleFromActivity(row: Activity, which: 'start' | 'end'): ScheduleParts {
  const sched = which === 'start' ? row.startSchedule : row.endSchedule
  if (sched && typeof sched === 'object') {
    return {
      year: sched.year ?? null,
      month: sched.month ?? null,
      day: sched.day ?? null,
      weekday: sched.weekday ?? null,
      time: sched.time ?? null,
    }
  }
  const iso = which === 'start' ? row.startAt : row.endAt
  if (!iso) return emptySchedule()
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return emptySchedule()
  const wd = d.getDay()
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: wd === 0 ? 7 : wd,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  }
}

function openCreate() {
  withSkipEndSync(() => {
    editingId.value = null
    form.title = ''
    form.type = 'daily'
    Object.assign(form.start, emptySchedule())
    Object.assign(form.end, emptySchedule())
    form.description = ''
    form.enableTeam = true
    form.enableReminder = true
    form.publishNow = true
    dialogOpen.value = true
  })
}

function openEdit(row: Activity) {
  if (row.status === 'cancelled' || row.status === 'ended') {
    ElMessage.warning('已结束或已取消的活动不可编辑')
    return
  }
  withSkipEndSync(() => {
    editingId.value = row.id
    form.title = row.title
    form.type = row.type
    Object.assign(form.start, scheduleFromActivity(row, 'start'))
    Object.assign(form.end, scheduleFromActivity(row, 'end'))
    form.description = row.description || ''
    form.enableTeam = Boolean(row.enableTeam)
    form.enableReminder = resolveReminderCycle(row) !== 'none'
    form.publishNow = false
    dialogOpen.value = true
  })
}

function hasAnySchedule(s: ScheduleParts) {
  return (
    s.year != null || s.month != null || s.day != null || s.weekday != null || Boolean(s.time)
  )
}

function toPayloadSchedule(s: ScheduleParts): ScheduleParts {
  return {
    year: s.year,
    month: s.month,
    day: s.day,
    weekday: s.weekday,
    time: s.time,
  }
}

async function onSubmit() {
  if (!form.title.trim()) {
    ElMessage.warning('请填写标题')
    return
  }
  if (!hasAnySchedule(form.start)) {
    ElMessage.warning('请填写开始的年月日、时间或星期几（至少一项）')
    return
  }
  if (form.enableReminder && !form.start.time) {
    ElMessage.warning('开启提醒需要填写开始时间')
    return
  }

  const reminderCycle = form.enableReminder
    ? preferredReminderCycle(form.start)
    : 'none'

  const body = {
    title: form.title.trim(),
    type: form.type,
    startSchedule: toPayloadSchedule(form.start),
    endSchedule: hasAnySchedule(form.end) ? toPayloadSchedule(form.end) : null,
    description: form.description.trim(),
    enableTeam: form.enableTeam,
    reminderCycle,
    reminderOffsetsMinutes: [],
  }

  try {
    if (editingId.value) {
      await updateActivity(editingId.value, body)
      ElMessage.success('已保存')
    } else {
      await createActivity({
        ...body,
        status: form.publishNow ? 'published' : 'draft',
      })
      ElMessage.success(form.publishNow ? '已创建并发布' : '已存为草稿')
    }
    dialogOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

const exportOpen = ref(false)
const exportLoading = ref(false)
const exportDownloading = ref(false)
const exportActivity = ref<Activity | null>(null)
const exportOptions = ref<RsvpOccurrenceOption[]>([])
const exportDateKey = ref('live')

async function onExportRsvp(row: Activity) {
  exportActivity.value = row
  exportDateKey.value = 'live'
  exportOptions.value = []
  exportOpen.value = true
  exportLoading.value = true
  try {
    const data = await fetchActivityRsvpOccurrences(row.id)
    exportOptions.value = data.options || []
    if (!exportOptions.value.some((o) => o.dateKey === exportDateKey.value)) {
      exportDateKey.value = exportOptions.value[0]?.dateKey || 'live'
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载场次失败')
    exportOpen.value = false
  } finally {
    exportLoading.value = false
  }
}

async function confirmExportRsvp() {
  const row = exportActivity.value
  if (!row) return
  exportDownloading.value = true
  try {
    const key = exportDateKey.value || 'live'
    const blob = await exportActivityRsvpsCsv(row.id, key)
    // 错误时接口可能仍以 blob 返回 JSON
    if (blob.type && blob.type.includes('application/json')) {
      const text = await blob.text()
      const parsed = JSON.parse(text) as { message?: string }
      throw new Error(parsed.message || '导出失败')
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safe = String(row.title || 'activity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
    const slot = key === 'live' ? '本场' : key
    a.download = `rsvp-${safe}-${slot}.csv`
    a.click()
    URL.revokeObjectURL(url)
    exportOpen.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  } finally {
    exportDownloading.value = false
  }
}

async function onPublish(row: Activity) {
  try {
    await transitionActivity(row.id, 'publish')
    ElMessage.success('已发布')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败')
  }
}

async function onCancel(row: Activity) {
  try {
    await ElMessageBox.confirm(`确定取消活动「${row.title}」？`, '取消活动', {
      type: 'warning',
      confirmButtonText: '取消活动',
      cancelButtonText: '返回',
    })
    await transitionActivity(row.id, 'cancel')
    ElMessage.success('已取消')
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

function formatSchedule(row: Activity, which: 'start' | 'end') {
  const s = scheduleFromActivity(row, which)
  if (!hasAnySchedule(s)) return '—'
  const parts: string[] = []
  if (s.year != null || s.month != null || s.day != null) {
    const y = s.year != null ? `${s.year}年` : ''
    const m = s.month != null ? `${s.month}月` : ''
    const d = s.day != null ? `${s.day}日` : ''
    parts.push(`${y}${m}${d}`)
  }
  if (s.weekday != null) {
    const w = WEEKDAY_OPTIONS.find((x) => x.value === s.weekday)
    parts.push(w?.label || `周${s.weekday}`)
  }
  if (s.time) parts.push(s.time)
  return parts.join(' ') || '—'
}

/** 旧活动可能只有提前量、无 reminderCycle；与小程序推断规则对齐 */
function resolveReminderCycle(row: Activity): ReminderCycle {
  const raw = row.reminderCycle
  if (raw === 'none') return 'none'
  if (raw && ['once', 'daily', 'weekly', 'monthly'].includes(raw)) return raw
  // 历史：无 cycle 但有提前量 → 视为曾开启，按开始分量推断
  if (!row.reminderOffsetsMinutes?.length) return 'none'
  return preferredReminderCycle(scheduleFromActivity(row, 'start'))
}

function formatCycle(row: Activity) {
  const c = resolveReminderCycle(row)
  if (c === 'none') return '关'
  return `开（${CYCLE_LABEL[c] || c}）`
}

function statusClass(status: ActivityStatus) {
  if (status === 'published' || status === 'ongoing') return 'ok'
  if (status === 'draft') return 'warn'
  return 'off'
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <section class="block activities-block">
      <header class="head row">
        <div>
          <h2>活动</h2>
          <p class="sub">
            开始须填年月日 / 时间 / 星期至少一项。提醒：年月日+时间仅一次；日+时间→一次/每天；周几+时间→一次/每周。
            整周自由组队：开始「周一 00:00」、结束「周日 23:59」（只填周几即可），建一次长期有效。
          </p>
        </div>
        <el-button type="primary" @click="openCreate">新建活动</el-button>
      </header>

      <div class="toolbar">
        <el-radio-group v-model="statusFilter" size="small">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="draft">草稿</el-radio-button>
          <el-radio-button label="published">已发布</el-radio-button>
          <el-radio-button label="ongoing">进行中</el-radio-button>
          <el-radio-button label="ended">已结束</el-radio-button>
          <el-radio-button label="cancelled">已取消</el-radio-button>
        </el-radio-group>
      </div>

      <div class="table-wrap">
        <el-table
          :data="filteredActivities"
          stripe
          empty-text="暂无活动"
          table-layout="fixed"
          height="100%"
          style="width: 100%"
        >
          <el-table-column prop="title" label="标题" min-width="120" show-overflow-tooltip />
          <el-table-column label="类型" width="110" min-width="110">
            <template #default="{ row }">
              {{ TYPE_LABEL[row.type as ActivityType] || row.type }}
            </template>
          </el-table-column>
          <el-table-column label="开始" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ formatSchedule(row, 'start') }}</template>
          </el-table-column>
          <el-table-column label="结束" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ formatSchedule(row, 'end') }}</template>
          </el-table-column>
          <el-table-column label="提醒" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ formatCycle(row) }}</template>
          </el-table-column>
          <el-table-column label="组队" width="100" min-width="100">
            <template #default="{ row }">{{ row.enableTeam ? '开' : '关' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110" min-width="110">
            <template #default="{ row }">
              <span :class="statusClass(row.status)">
                {{ STATUS_LABEL[row.status as ActivityStatus] }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="300" min-width="300" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status !== 'cancelled' && row.status !== 'ended'"
                text
                type="primary"
                @click="openEdit(row)"
              >
                编辑
              </el-button>
              <el-button
                v-if="row.status === 'draft'"
                text
                type="primary"
                @click="onPublish(row)"
              >
                发布
              </el-button>
              <el-button text type="primary" @click="onExportRsvp(row)">导出 RSVP</el-button>
              <el-button
                v-if="['draft', 'published', 'ongoing'].includes(row.status)"
                text
                type="danger"
                @click="onCancel(row)"
              >
                取消
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog
      v-model="dialogOpen"
      :title="editingId ? '编辑活动' : '新建活动'"
      width="680px"
      destroy-on-close
    >
      <el-form label-width="100px" @submit.prevent="onSubmit">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="64" show-word-limit />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option
              v-for="(label, key) in TYPE_LABEL"
              :key="key"
              :label="label"
              :value="key"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="开始" required>
          <div class="sched">
            <el-select v-model="form.start.year" clearable placeholder="年" class="sched-year">
              <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
            </el-select>
            <el-select v-model="form.start.month" clearable placeholder="月" class="sched-sm">
              <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
            </el-select>
            <el-select v-model="form.start.day" clearable placeholder="日" class="sched-sm">
              <el-option v-for="d in 31" :key="d" :label="`${d}日`" :value="d" />
            </el-select>
            <el-select v-model="form.start.weekday" clearable placeholder="星期" class="sched-wd">
              <el-option
                v-for="w in WEEKDAY_OPTIONS"
                :key="w.value"
                :label="w.label"
                :value="w.value"
              />
            </el-select>
            <el-time-select
              v-model="form.start.time"
              start="00:00"
              step="00:05"
              end="23:55"
              placeholder="时间"
              clearable
              class="sched-time"
            />
            <el-button text type="primary" class="sched-quick" @click="fillStartToday">
              填入今天
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="结束">
          <div class="sched">
            <el-select v-model="form.end.year" clearable placeholder="年" class="sched-year">
              <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
            </el-select>
            <el-select v-model="form.end.month" clearable placeholder="月" class="sched-sm">
              <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
            </el-select>
            <el-select v-model="form.end.day" clearable placeholder="日" class="sched-sm">
              <el-option v-for="d in 31" :key="d" :label="`${d}日`" :value="d" />
            </el-select>
            <el-select v-model="form.end.weekday" clearable placeholder="星期" class="sched-wd">
              <el-option
                v-for="w in WEEKDAY_OPTIONS"
                :key="w.value"
                :label="w.label"
                :value="w.value"
              />
            </el-select>
            <el-time-select
              v-model="form.end.time"
              start="00:00"
              step="00:05"
              end="23:55"
              placeholder="时间"
              clearable
              class="sched-time"
            />
            <el-button text type="primary" class="sched-quick" @click="fillEndToday">
              填入今天
            </el-button>
          </div>
          <p class="field-tip">
            默认随开始联动（同日 +30 分钟）。可改成不同周几：结束周几按本场开始日起算（如周一→周日=整周组队容器）。「填入今天」只写日期与星期，不改时间。
          </p>
        </el-form-item>

        <el-form-item label="开启提醒">
          <el-switch v-model="form.enableReminder" />
          <span class="hint">提前量一律用「提醒设置」；须填开始时间。成员需在小程序点「提醒我」。</span>
        </el-form-item>
        <el-form-item label="开启组队">
          <el-switch v-model="form.enableTeam" />
          <span class="hint">开启后，小程序活动详情可建队 / 申请入队</span>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="立即发布">
          <el-switch v-model="form.publishNow" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">返回</el-button>
        <el-button type="primary" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="exportOpen"
      title="导出 RSVP"
      width="420px"
      destroy-on-close
      append-to-body
      class="rsvp-export-dialog"
    >
      <div v-loading="exportLoading">
        <p class="export-lead">
          选择场次后下载 CSV。历史场次来自周期换场快照；换场前未部署新版云函数的场次无法补导。
        </p>
        <el-form label-width="72px">
          <el-form-item label="活动">
            <span>{{ exportActivity?.title || '—' }}</span>
          </el-form-item>
          <el-form-item label="场次">
            <el-select v-model="exportDateKey" style="width: 100%" :disabled="!exportOptions.length">
              <el-option
                v-for="o in exportOptions"
                :key="o.dateKey"
                :label="`${o.label}（${o.rowCount} 人）`"
                :value="o.dateKey"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="exportOpen = false">返回</el-button>
        <el-button
          type="primary"
          :loading="exportDownloading"
          :disabled="exportLoading || !exportDateKey"
          @click="confirmExportRsvp"
        >
          下载 CSV
        </el-button>
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

.block {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.activities-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-wrap {
  flex: 1;
  min-height: 160px;
  overflow: hidden;
}

.head h2 {
  margin: 0 0 var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-lg);
}

.head.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
  flex-shrink: 0;
}

.sub {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.toolbar {
  margin-bottom: var(--space-3);
  flex-shrink: 0;
}

.ok {
  color: var(--color-success);
}
.warn {
  color: var(--color-warning);
}
.off,
.muted {
  color: var(--color-text-muted);
}

.hint {
  margin-left: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.field-tip {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.4;
  min-height: 2.8em; /* 占位，避免说明显隐导致表单高度跳动 */
}

.export-lead {
  margin: var(--space-2) 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.sched {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  width: 100%;
}

.sched-year {
  width: 100px;
}

.sched-sm {
  width: 88px;
}

.sched-wd {
  width: 100px;
}

.sched-time {
  width: 120px;
}

.sched-quick.el-button.is-text.el-button--primary {
  padding: 0 var(--space-2);
  height: auto;
  flex-shrink: 0;
  cursor: pointer;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.sched-quick.el-button.is-text.el-button--primary:hover,
.sched-quick.el-button.is-text.el-button--primary:focus,
.sched-quick.el-button.is-text.el-button--primary:focus-visible {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none;
  color: var(--color-brand) !important;
  cursor: pointer;
}
</style>

<style>
/* append-to-body 弹窗：拉大标题下边线与正文间距 */
.rsvp-export-dialog.el-dialog .el-dialog__body {
  padding-top: var(--space-3, 12px);
}
</style>
