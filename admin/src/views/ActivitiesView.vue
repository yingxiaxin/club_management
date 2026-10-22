<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createActivity,
  fetchActivities,
  transitionActivity,
  updateActivity,
  type Activity,
  type ActivityStatus,
  type ActivityType,
  type ReminderCycle,
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
const statusFilter = ref<'all' | ActivityStatus>('all')

const dialogOpen = ref(false)
const editingId = ref<string | null>(null)

function emptySchedule(): ScheduleParts {
  return { year: null, month: null, day: null, weekday: null, time: null }
}

const form = reactive({
  title: '',
  type: 'daily' as ActivityType,
  start: emptySchedule(),
  end: emptySchedule(),
  description: '',
  enableTeam: false,
  reminderCycle: 'none' as ReminderCycle,
  reminderMinutes: 10,
  publishNow: false,
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

/** 根据开始日程分量决定可选提醒周期 */
const allowedCycles = computed((): ReminderCycle[] => {
  const s = form.start
  if (!s.time) return ['none']
  const full = s.year != null && s.month != null && s.day != null
  if (full) return ['once']
  const opts: ReminderCycle[] = []
  const push = (c: ReminderCycle) => {
    if (!opts.includes(c)) opts.push(c)
  }
  if (s.day != null) {
    push('once')
    push('daily')
  }
  if (s.weekday != null) {
    push('once')
    push('weekly')
  }
  if (opts.length) return opts
  return ['daily']
})

watch(
  allowedCycles,
  (opts) => {
    if (!opts.includes(form.reminderCycle)) {
      form.reminderCycle = opts[0] || 'none'
    }
    if (form.reminderCycle === 'none') {
      /* 无时间或不提醒 */
    }
  },
  { immediate: true },
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
  editingId.value = null
  form.title = ''
  form.type = 'daily'
  Object.assign(form.start, emptySchedule())
  Object.assign(form.end, emptySchedule())
  form.description = ''
  form.enableTeam = false
  form.reminderCycle = 'none'
  form.reminderMinutes = 10
  form.publishNow = false
  dialogOpen.value = true
}

function openEdit(row: Activity) {
  if (row.status === 'cancelled' || row.status === 'ended') {
    ElMessage.warning('已结束或已取消的活动不可编辑')
    return
  }
  editingId.value = row.id
  form.title = row.title
  form.type = row.type
  Object.assign(form.start, scheduleFromActivity(row, 'start'))
  Object.assign(form.end, scheduleFromActivity(row, 'end'))
  form.description = row.description || ''
  form.enableTeam = Boolean(row.enableTeam)
  form.reminderCycle = (row.reminderCycle as ReminderCycle) || 'none'
  form.reminderMinutes = row.reminderOffsetsMinutes?.[0] || 10
  form.publishNow = false
  dialogOpen.value = true
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
  if (!allowedCycles.value.includes(form.reminderCycle)) {
    ElMessage.warning('当前开始时间分量下，提醒周期不可用，请重选')
    return
  }

  const body = {
    title: form.title.trim(),
    type: form.type,
    startSchedule: toPayloadSchedule(form.start),
    endSchedule: hasAnySchedule(form.end) ? toPayloadSchedule(form.end) : null,
    description: form.description.trim(),
    enableTeam: form.enableTeam,
    reminderCycle: form.reminderCycle,
    reminderOffsetsMinutes:
      form.reminderCycle === 'none' ? [] : [form.reminderMinutes],
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

function formatCycle(row: Activity) {
  const c = (row.reminderCycle || 'none') as ReminderCycle
  if (c === 'none' || !row.reminderOffsetsMinutes?.length) return CYCLE_LABEL.none
  const mins = row.reminderOffsetsMinutes[0]
  return `${CYCLE_LABEL[c] || c}（提前${mins}分）`
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
          <el-table-column label="类型" width="72">
            <template #default="{ row }">
              {{ TYPE_LABEL[row.type as ActivityType] || row.type }}
            </template>
          </el-table-column>
          <el-table-column label="开始" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ formatSchedule(row, 'start') }}</template>
          </el-table-column>
          <el-table-column label="结束" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ formatSchedule(row, 'end') }}</template>
          </el-table-column>
          <el-table-column label="提醒" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ formatCycle(row) }}</template>
          </el-table-column>
          <el-table-column label="组队" width="64">
            <template #default="{ row }">{{ row.enableTeam ? '开' : '关' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <span :class="statusClass(row.status)">
                {{ STATUS_LABEL[row.status as ActivityStatus] }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="260" fixed="right">
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
              <el-button
                v-if="['draft', 'published', 'ongoing'].includes(row.status)"
                text
                type="danger"
                @click="onCancel(row)"
              >
                取消
              </el-button>
              <span v-if="row.status === 'cancelled' || row.status === 'ended'" class="muted">—</span>
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
              step="00:15"
              end="23:45"
              placeholder="时间"
              clearable
              class="sched-time"
            />
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
              step="00:15"
              end="23:45"
              placeholder="时间"
              clearable
              class="sched-time"
            />
          </div>
        </el-form-item>

        <el-form-item label="提醒周期">
          <el-select v-model="form.reminderCycle" style="width: 100%">
            <el-option
              v-for="c in allowedCycles"
              :key="c"
              :label="CYCLE_LABEL[c]"
              :value="c"
            />
          </el-select>
          <p class="field-tip">
            未填时间 → 不提醒；年月日+时间 → 仅一次；日+时间 → 一次/每天；周几+时间 → 一次/每周；仅时间 → 每天。
          </p>
        </el-form-item>
        <el-form-item label="提前量">
          <el-select v-model="form.reminderMinutes" style="width: 100%">
            <el-option :value="5" label="5 分钟" />
            <el-option :value="10" label="10 分钟（默认）" />
            <el-option :value="15" label="15 分钟" />
            <el-option :value="30" label="30 分钟" />
            <el-option :value="60" label="1 小时" />
            <el-option :value="120" label="2 小时" />
          </el-select>
          <p class="field-tip">
            {{
              form.reminderCycle === 'none'
                ? '当前为「不提醒」时，提前量不会发送。'
                : '将按所选周期与提前量发送提醒（订阅链路在后续阶段接通）。'
            }}
          </p>
        </el-form-item>

        <el-form-item label="开启组队">
          <el-switch v-model="form.enableTeam" />
          <span class="hint">P2 组队入口用；本阶段仅占位</span>
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
</style>
