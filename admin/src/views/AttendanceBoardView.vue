<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchAttendance,
  fetchMemberStats,
  fetchTodayBoard,
  fetchWeekBoard,
  saveAttendance,
  type AttendancePayload,
  type AttendancePerson,
  type BoardActivity,
  type BoardMeta,
  type MemberStatRecent,
  type MemberStatRow,
  type RsvpCounts,
} from '@/api/board'
import { fetchMembers } from '@/api/members'
import type { Member } from '@/types/member'
import { pathwayRowClassName, pathwayTagClass } from '@/utils/pathway'

const tab = ref<'today' | 'week' | 'members'>('today')
const loading = ref(false)
const meta = ref<BoardMeta | null>(null)
const today = ref<BoardActivity[]>([])
const week = ref<BoardActivity[]>([])

const memberLoading = ref(false)
const memberWeeks = ref(4)
const memberRows = ref<MemberStatRow[]>([])
const memberCutoff = ref('')
const detailMember = ref<MemberStatRow | null>(null)
const memberDrawerOpen = ref(false)

const drawerOpen = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const attendance = ref<AttendancePayload | null>(null)
const presentIds = ref<string[]>([])
/** 打开抽屉时的实到快照，用于判断导出前是否有未保存勾选 */
const baselinePresentIds = ref<string[]>([])
const extras = ref<AttendancePerson[]>([])
const allMembers = ref<Member[]>([])
const addMemberIds = ref<string[]>([])
const detailTitle = ref('')
const detailDateKey = ref<string | null>(null)
const detailActivityId = ref('')
const exporting = ref(false)

const dateLine = computed(() => {
  const m = meta.value
  if (!m?.today) return ''
  const t = m.today
  return `${t.year}年${t.month}月${t.day}日 ${t.weekdayLabel}`
})

const weekRange = computed(() => {
  const m = meta.value
  if (!m?.weekStart || !m?.weekEnd) return ''
  const a = m.weekStart
  const b = m.weekEnd
  return `${a.month}/${a.day} – ${b.month}/${b.day}`
})

const presentCount = computed(() => presentIds.value.length)

const presentDirty = computed(() => {
  if (!attendance.value?.canEdit) return false
  const a = [...presentIds.value].map(String).sort()
  const b = [...baselinePresentIds.value].map(String).sort()
  if (a.length !== b.length) return true
  return a.some((id, i) => id !== b[i])
})

const rsvpIdSet = computed(() => {
  const s = new Set<string>()
  for (const p of attendance.value?.people || []) {
    if (p.memberId) s.add(p.memberId)
  }
  return s
})

const addableMembers = computed(() => {
  const taken = new Set([...rsvpIdSet.value, ...extras.value.map((e) => String(e.memberId))])
  return allMembers.value.filter((m) => m.id && !taken.has(m.id))
})

function rsvpLine(c: RsvpCounts) {
  return `参加 ${c.going} · 待定 ${c.maybe} · 请假 ${c.decline}`
}

function phaseTagType(row: BoardActivity) {
  if (row.occurrenceEnded) return 'info'
  if (row.occurrenceStarted || row.occurrencePhase === 'ongoing') return 'warning'
  return 'success'
}

function attendanceLine(row: BoardActivity) {
  if (!row.attendance?.saved) return ''
  const a = row.attendance
  return `实到 ${a.presentCount}${a.goingCountAtSave != null ? ` / 报名 ${a.goingCountAtSave}` : ''}（${a.rateLabel}）`
}

function isPresent(memberId?: string) {
  if (!memberId) return false
  return presentIds.value.includes(memberId)
}

function setPresent(memberId: string | undefined, on: boolean) {
  if (!memberId || !attendance.value?.canEdit) return
  const set = new Set(presentIds.value)
  if (on) set.add(memberId)
  else set.delete(memberId)
  presentIds.value = [...set]
}

function togglePresent(memberId?: string) {
  if (!memberId || !attendance.value?.canEdit) return
  setPresent(memberId, !isPresent(memberId))
}

function removeExtra(memberId?: string) {
  if (!memberId || !attendance.value?.canEdit) return
  setPresent(memberId, false)
  extras.value = extras.value.filter((e) => e.memberId !== memberId)
}

function addExtraFromPicker() {
  if (!attendance.value?.canEdit) return
  const ids = [...new Set(addMemberIds.value.map(String).filter(Boolean))]
  if (!ids.length) return
  const existingExtra = new Set(extras.value.map((e) => String(e.memberId)))
  const next = [...extras.value]
  for (const id of ids) {
    if (rsvpIdSet.value.has(id) || existingExtra.has(id)) continue
    const m = allMembers.value.find((x) => x.id === id)
    next.push({
      memberId: id,
      characterName: m?.characterName || id,
      pathway: m?.pathway || '',
      status: '',
      statusLabel: '未报名',
      present: true,
    })
    existingExtra.add(id)
    setPresent(id, true)
  }
  extras.value = next
  addMemberIds.value = []
}

async function ensureMemberOptions() {
  if (allMembers.value.length) return
  try {
    allMembers.value = await fetchMembers()
  } catch {
    allMembers.value = []
  }
}

async function load() {
  loading.value = true
  try {
    const [t, w] = await Promise.all([fetchTodayBoard(), fetchWeekBoard()])
    today.value = t.activities || []
    week.value = w.activities || []
    meta.value = t.meta || w.meta || null
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载看板失败')
  } finally {
    loading.value = false
  }
}

async function loadMembers() {
  memberLoading.value = true
  try {
    const data = await fetchMemberStats(memberWeeks.value)
    memberRows.value = data.members || []
    memberCutoff.value = data.cutoffDateKey || ''
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载成员摘要失败')
  } finally {
    memberLoading.value = false
  }
}

/** 页头唯一刷新：按当前 Tab 拉对应数据 */
async function refresh() {
  if (tab.value === 'members') await loadMembers()
  else await load()
}

const refreshLoading = computed(() =>
  tab.value === 'members' ? memberLoading.value : loading.value,
)

async function openDetail(row: BoardActivity) {
  detailTitle.value = row.title
  detailDateKey.value = row.occurrenceDateKey
  detailActivityId.value = row.id
  attendance.value = null
  presentIds.value = []
  baselinePresentIds.value = []
  extras.value = []
  addMemberIds.value = []
  drawerOpen.value = true
  detailLoading.value = true
  try {
    await ensureMemberOptions()
    const data = await fetchAttendance(row.id, row.occurrenceDateKey)
    attendance.value = data
    presentIds.value = [...(data.presentMemberIds || [])]
    baselinePresentIds.value = [...(data.presentMemberIds || [])]
    extras.value = [...(data.extras || [])]
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载名单失败')
  } finally {
    detailLoading.value = false
  }
}

function csvCell(v: unknown) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

function downloadRosterCsv() {
  const att = attendance.value
  if (!att) return
  const dateKey = detailDateKey.value || att.occurrenceDateKey || ''
  const present = new Set(presentIds.value.map(String))
  const header = ['角色名', '途径', 'RSVP', '实到', '场次日']
  const lines = [header.map(csvCell).join(',')]
  const rows: AttendancePerson[] = [...(att.people || []), ...(extras.value || [])]
  for (const p of rows) {
    const mid = String(p.memberId || '')
    lines.push(
      [
        p.characterName || '',
        p.pathway || '',
        p.statusLabel || p.status || '',
        mid && present.has(mid) ? '是' : '否',
        dateKey,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safe = String(detailTitle.value || att.title || 'activity')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 40)
  a.download = `点名-${safe}-${dateKey || '本场'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function onExportRoster() {
  if (!attendance.value) return
  exporting.value = true
  try {
    if (presentDirty.value) {
      try {
        await ElMessageBox.confirm(
          '有未保存的实到勾选，导出将按当前勾选（尚未入库）。建议先「保存实到」再导出。',
          '导出点名表',
          {
            type: 'warning',
            confirmButtonText: '仍按勾选导出',
            cancelButtonText: '取消',
          },
        )
      } catch {
        return
      }
    } else if (attendance.value.canEdit && !attendance.value.saved) {
      try {
        await ElMessageBox.confirm(
          '本场点名尚未保存入库；导出按当前勾选。需要统计实到率请先保存。',
          '导出点名表',
          {
            type: 'info',
            confirmButtonText: '继续导出',
            cancelButtonText: '取消',
          },
        )
      } catch {
        return
      }
    }
    downloadRosterCsv()
    ElMessage.success('已下载点名表')
  } finally {
    exporting.value = false
  }
}

async function onSaveAttendance() {
  if (!detailActivityId.value || !attendance.value?.canEdit) return
  saving.value = true
  try {
    const data = await saveAttendance(detailActivityId.value, {
      presentMemberIds: presentIds.value,
      dateKey: detailDateKey.value || attendance.value.occurrenceDateKey,
    })
    ElMessage.success('实到已保存')
    attendance.value = data
    presentIds.value = [...(data.presentMemberIds || [])]
    baselinePresentIds.value = [...(data.presentMemberIds || [])]
    extras.value = [...(data.extras || [])]
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

function openMemberDetail(row: MemberStatRow) {
  detailMember.value = row
  memberDrawerOpen.value = true
}

function statusTone(status: string) {
  if (status === 'going' || status === 'present') return 'success'
  if (status === 'maybe') return 'warning'
  return 'info'
}

watch(tab, (name) => {
  if (name === 'members' && !memberRows.value.length && !memberLoading.value) {
    loadMembers()
  }
})

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <header class="head">
      <div>
        <h1>出勤看板</h1>
        <p class="sub">
          今日 / 本周 RSVP 与实到；点卡片点名。成员摘要看近几周意向。
          <span v-if="dateLine" class="meta">今日 {{ dateLine }}</span>
          <span v-if="weekRange" class="meta">本周 {{ weekRange }}</span>
        </p>
      </div>
      <el-button type="primary" :loading="refreshLoading" @click="refresh">刷新</el-button>
    </header>

    <el-tabs v-model="tab" class="tabs">
      <el-tab-pane label="今日一屏" name="today">
        <div class="pane-scroll">
          <div v-if="!today.length" class="empty">今日暂无本场活动</div>
          <div v-else class="cards">
            <button
              v-for="row in today"
              :key="row.id"
              type="button"
              class="card"
              @click="openDetail(row)"
            >
              <div class="card-top">
                <span class="card-title">{{ row.title }}</span>
                <el-tag size="small" :type="phaseTagType(row)" effect="plain">
                  {{ row.occurrencePhaseLabel || row.statusLabel || '—' }}
                </el-tag>
              </div>
              <div class="card-time">{{ row.startText || '时间待定' }}</div>
              <div class="card-rsvp">{{ rsvpLine(row.rsvpCounts) }}</div>
              <div v-if="attendanceLine(row)" class="card-att">{{ attendanceLine(row) }}</div>
              <div v-if="row.enableTeam && row.teamSummary" class="card-team">
                招募中 {{ row.teamSummary.recruitingCount }} 队
                <template v-if="row.teamSummary.seatsShort > 0">
                  · 差 {{ row.teamSummary.seatsShort }} 人
                </template>
                <template v-else-if="row.teamSummary.recruitingCount === 0"> · 无招募中</template>
              </div>
              <div v-else-if="row.enableTeam" class="card-team muted">已开启组队</div>
            </button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="本周概览" name="week">
        <div class="table-wrap">
          <el-table
            :data="week"
            stripe
            height="100%"
            style="width: 100%"
            empty-text="本周暂无活动"
            @row-click="openDetail"
          >
            <el-table-column label="日期" width="120">
              <template #default="{ row }">
                {{ row.occurrenceDateKey || '—' }}
              </template>
            </el-table-column>
            <el-table-column prop="title" label="活动" min-width="160" />
            <el-table-column label="本场时间" min-width="140">
              <template #default="{ row }">{{ row.startText || '—' }}</template>
            </el-table-column>
            <el-table-column label="阶段" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="phaseTagType(row)" effect="plain">
                  {{ row.occurrencePhaseLabel || row.statusLabel || '—' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="参加" width="64" align="center">
              <template #default="{ row }">{{ row.rsvpCounts.going }}</template>
            </el-table-column>
            <el-table-column label="待定" width="64" align="center">
              <template #default="{ row }">{{ row.rsvpCounts.maybe }}</template>
            </el-table-column>
            <el-table-column label="请假" width="64" align="center">
              <template #default="{ row }">{{ row.rsvpCounts.decline }}</template>
            </el-table-column>
            <el-table-column label="实到" width="88" align="center">
              <template #default="{ row }">
                <template v-if="row.attendance?.saved">{{ row.attendance.presentCount }}</template>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="成员摘要" name="members">
        <div class="members-pane">
          <div class="members-toolbar">
            <span class="muted">近</span>
            <el-select v-model="memberWeeks" style="width: 88px" @change="loadMembers">
              <el-option :value="2" label="2 周" />
              <el-option :value="4" label="4 周" />
              <el-option :value="8" label="8 周" />
            </el-select>
            <span v-if="memberCutoff" class="muted">自 {{ memberCutoff }} 起有 RSVP 的场次</span>
          </div>
          <div class="table-wrap">
            <el-table
              v-loading="memberLoading"
              class="members-table"
              :data="memberRows"
              stripe
              table-layout="fixed"
              height="100%"
              style="width: 100%"
              empty-text="暂无 RSVP 数据"
              :row-class-name="pathwayRowClassName"
              @row-click="openMemberDetail"
            >
              <el-table-column label="角色名" min-width="1" show-overflow-tooltip>
                <template #default="{ row }">{{ row.characterName || '—' }}</template>
              </el-table-column>
              <el-table-column label="途径" min-width="1" show-overflow-tooltip>
                <template #default="{ row }">
                  <span
                    class="pathway-tag"
                    :class="pathwayTagClass(row.pathway)"
                    :title="row.pathway || ''"
                  >{{ row.pathway || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="参加" min-width="1" align="center" prop="going" sortable />
              <el-table-column label="待定" min-width="1" align="center" prop="maybe" sortable />
              <el-table-column label="请假" min-width="1" align="center" prop="decline" sortable />
              <el-table-column label="实到" min-width="1" align="center" prop="present" sortable />
              <el-table-column label="意向场次" min-width="1" align="center" prop="total" sortable />
              <el-table-column label="意向率" min-width="1" align="center" prop="intentionRate" sortable>
                <template #default="{ row }">
                  {{ row.intentionRate == null ? '—' : `${row.intentionRate}%` }}
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="drawerOpen" :title="detailTitle || '本场名单'" size="460px">
      <div v-loading="detailLoading" class="drawer-body">
        <template v-if="attendance">
          <p class="drawer-sum">
            {{ rsvpLine({
              going: attendance.goingCount,
              maybe: attendance.people.filter((p) => p.status === 'maybe').length,
              decline: attendance.people.filter((p) => p.status === 'decline').length,
              total: attendance.people.length,
            }) }}
            · 勾选实到 {{ presentCount }}
          </p>
          <p v-if="!attendance.canEdit" class="hint">活动未开始，暂不可点名；可查看 RSVP。</p>
          <p v-else class="hint">
            默认预勾「参加」；待定 / 请假可勾；未报名可用下方补录。
            <template v-if="attendance.occurrenceEnded">
              场次 {{ attendance.occurrenceDateKey }}
              <template v-if="attendance.saved"> · 已保存</template>
            </template>
            <template v-else> · 进行中可预勾，结束后保存计入统计</template>
          </p>

          <div class="drawer-actions">
            <el-button
              v-if="attendance.canEdit"
              type="primary"
              :loading="saving"
              @click="onSaveAttendance"
            >
              保存实到
            </el-button>
            <el-button :loading="exporting" @click="onExportRoster">导出点名表</el-button>
          </div>

          <section
            v-for="key in (['going', 'maybe', 'decline'] as const)"
            :key="key"
            class="group"
          >
            <h3>
              {{ key === 'going' ? '参加' : key === 'maybe' ? '待定' : '请假' }}
              （{{ attendance.people.filter((p) => p.status === key).length }}）
            </h3>
            <ul v-if="attendance.people.some((p) => p.status === key)">
              <li
                v-for="p in attendance.people.filter((x) => x.status === key)"
                :key="`${key}-${p.memberId}`"
                class="person"
                :class="{ editable: attendance.canEdit }"
                @click="togglePresent(p.memberId)"
              >
                <el-checkbox
                  :model-value="isPresent(p.memberId)"
                  :disabled="!attendance.canEdit || !p.memberId"
                  @click.stop
                  @update:model-value="(v: boolean) => setPresent(p.memberId, v)"
                />
                <span class="name">{{ p.characterName || '—' }}</span>
                <span
                  v-if="p.pathway"
                  class="pathway"
                  :class="pathwayTagClass(p.pathway)"
                >{{ p.pathway }}</span>
              </li>
            </ul>
            <p v-else class="muted">暂无</p>
          </section>

          <section class="group">
            <h3>未报名补录（{{ extras.length }}）</h3>
            <div v-if="attendance.canEdit" class="add-extra">
              <el-select
                v-model="addMemberIds"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="搜索并多选角色名补录"
                style="flex: 1"
              >
                <el-option
                  v-for="m in addableMembers"
                  :key="m.id"
                  :label="m.pathway ? `${m.characterName}（${m.pathway}）` : m.characterName"
                  :value="m.id"
                />
              </el-select>
              <el-button type="primary" :disabled="!addMemberIds.length" @click="addExtraFromPicker">
                加入
              </el-button>
            </div>
            <ul v-if="extras.length">
              <li
                v-for="p in extras"
                :key="`extra-${p.memberId}`"
                class="person"
                :class="{ editable: attendance.canEdit }"
              >
                <el-checkbox
                  :model-value="isPresent(p.memberId)"
                  :disabled="!attendance.canEdit || !p.memberId"
                  @update:model-value="(v: boolean) => (v ? setPresent(p.memberId, true) : removeExtra(p.memberId))"
                />
                <span class="name">{{ p.characterName || '—' }}</span>
                <span
                  v-if="p.pathway"
                  class="pathway"
                  :class="pathwayTagClass(p.pathway)"
                >{{ p.pathway }}</span>
                <el-button
                  v-if="attendance.canEdit"
                  class="remove-extra"
                  text
                  type="danger"
                  size="small"
                  @click="removeExtra(p.memberId)"
                >
                  移除
                </el-button>
              </li>
            </ul>
            <p v-else class="muted">暂无补录；未填意向但到场的人可从上方搜索加入。</p>
          </section>
        </template>
      </div>
    </el-drawer>

    <el-drawer
      v-model="memberDrawerOpen"
      :title="detailMember ? `${detailMember.characterName} · 近场明细` : '明细'"
      size="420px"
    >
      <template v-if="detailMember">
        <p class="drawer-sum">
          参加 {{ detailMember.going }} · 待定 {{ detailMember.maybe }} · 请假 {{ detailMember.decline }}
          · 实到 {{ detailMember.present || 0 }}
          · 意向率 {{ detailMember.intentionRate == null ? '—' : `${detailMember.intentionRate}%` }}
        </p>
        <ul class="recent-list">
          <li v-for="(r, i) in detailMember.recent as MemberStatRecent[]" :key="`${r.activityId}-${r.dateKey}-${i}`">
            <span class="recent-date">{{ r.dateKey }}</span>
            <span class="recent-title">{{ r.title }}</span>
            <el-tag size="small" :type="statusTone(r.status)" effect="plain">{{ r.statusLabel }}</el-tag>
          </li>
        </ul>
        <p v-if="!detailMember.recent?.length" class="muted">暂无明细</p>
      </template>
    </el-drawer>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-shrink: 0;
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

.meta {
  display: inline-block;
  margin-left: var(--space-3);
  color: var(--color-text-muted);
}

.tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin-bottom: var(--space-3);
}

.tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tabs :deep(.el-tab-pane) {
  height: 100%;
}

.pane-scroll {
  height: 100%;
  overflow: auto;
  padding-right: 2px;
}

.table-wrap {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.members-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  gap: var(--space-3);
}

.members-pane .table-wrap {
  flex: 1;
}

.empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}

.card {
  text-align: left;
  cursor: pointer;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  color: var(--color-text);
  box-shadow: inset 0 1px 0 var(--color-inset-highlight);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.card:hover {
  border-color: var(--color-brand);
  background: var(--color-brand-muted);
}

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.card-title {
  font-weight: 600;
  font-size: var(--font-size-md);
  line-height: 1.35;
}

.card-time {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--space-2);
}

.card-rsvp {
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.card-att {
  margin-top: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-success);
}

.card-team {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-brand-hover);
}

.card-team.muted,
.muted {
  color: var(--color-text-muted);
}

.members-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.members-table {
  width: 100%;
}

.drawer-body {
  min-height: 200px;
}

.drawer-sum {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.hint {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  line-height: 1.45;
}

.group {
  margin-bottom: var(--space-5);
}

.group h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-brand-hover);
  font-weight: 600;
}

.group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.person {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}

.person.editable {
  cursor: pointer;
}

.name {
  color: var(--color-text);
}

.pathway {
  margin-left: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.pathway.pathway-tag-audience {
  color: var(--color-pathway-audience);
}
.pathway.pathway-tag-warrior {
  color: var(--color-pathway-warrior);
}
.pathway.pathway-tag-bard {
  color: var(--color-pathway-bard);
}
.pathway.pathway-tag-apprentice {
  color: var(--color-pathway-apprentice);
}
.pathway.pathway-tag-diviner {
  color: var(--color-pathway-diviner);
}
.pathway.pathway-tag-pryer {
  color: var(--color-pathway-pryer);
}

/* 途径色签（与成员列表一致） */
.pathway-tag {
  display: inline-block;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
  box-sizing: border-box;
}

.pathway-tag.pathway-tag-audience {
  color: var(--color-pathway-audience);
  border-color: var(--color-pathway-audience);
  background: var(--color-pathway-audience-muted);
}
.pathway-tag.pathway-tag-warrior {
  color: var(--color-pathway-warrior);
  border-color: var(--color-pathway-warrior);
  background: var(--color-pathway-warrior-muted);
}
.pathway-tag.pathway-tag-bard {
  color: var(--color-pathway-bard);
  border-color: var(--color-pathway-bard);
  background: var(--color-pathway-bard-muted);
}
.pathway-tag.pathway-tag-apprentice {
  color: var(--color-pathway-apprentice);
  border-color: var(--color-pathway-apprentice);
  background: var(--color-pathway-apprentice-muted);
}
.pathway-tag.pathway-tag-diviner {
  color: var(--color-pathway-diviner);
  border-color: var(--color-pathway-diviner);
  background: var(--color-pathway-diviner-muted);
}
.pathway-tag.pathway-tag-pryer {
  color: var(--color-pathway-pryer);
  border-color: var(--color-pathway-pryer);
  background: var(--color-pathway-pryer-muted);
}

/* 行背景：左侧色条 + muted 渐变（与成员列表一致） */
.table-wrap :deep(.el-table .pathway-row-audience > td.el-table__cell),
.table-wrap :deep(.el-table .pathway-row-warrior > td.el-table__cell),
.table-wrap :deep(.el-table .pathway-row-bard > td.el-table__cell),
.table-wrap :deep(.el-table .pathway-row-apprentice > td.el-table__cell),
.table-wrap :deep(.el-table .pathway-row-diviner > td.el-table__cell),
.table-wrap :deep(.el-table .pathway-row-pryer > td.el-table__cell) {
  background-color: transparent !important;
  background-image: none !important;
}

.table-wrap :deep(.el-table tr.pathway-row-audience) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-audience) 0,
    var(--color-pathway-audience) 3px,
    var(--color-pathway-audience-muted) 3px,
    transparent 100%
  );
}
.table-wrap :deep(.el-table tr.pathway-row-warrior) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-warrior) 0,
    var(--color-pathway-warrior) 3px,
    var(--color-pathway-warrior-muted) 3px,
    transparent 100%
  );
}
.table-wrap :deep(.el-table tr.pathway-row-bard) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-bard) 0,
    var(--color-pathway-bard) 3px,
    var(--color-pathway-bard-muted) 3px,
    transparent 100%
  );
}
.table-wrap :deep(.el-table tr.pathway-row-apprentice) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-apprentice) 0,
    var(--color-pathway-apprentice) 3px,
    var(--color-pathway-apprentice-muted) 3px,
    transparent 100%
  );
}
.table-wrap :deep(.el-table tr.pathway-row-diviner) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-diviner) 0,
    var(--color-pathway-diviner) 3px,
    var(--color-pathway-diviner-muted) 3px,
    transparent 100%
  );
}
.table-wrap :deep(.el-table tr.pathway-row-pryer) {
  background: linear-gradient(
    90deg,
    var(--color-pathway-pryer) 0,
    var(--color-pathway-pryer) 3px,
    var(--color-pathway-pryer-muted) 3px,
    transparent 100%
  );
}

.table-wrap :deep(.el-table tr.pathway-row-audience:hover > td.el-table__cell),
.table-wrap :deep(.el-table tr.pathway-row-warrior:hover > td.el-table__cell),
.table-wrap :deep(.el-table tr.pathway-row-bard:hover > td.el-table__cell),
.table-wrap :deep(.el-table tr.pathway-row-apprentice:hover > td.el-table__cell),
.table-wrap :deep(.el-table tr.pathway-row-diviner:hover > td.el-table__cell),
.table-wrap :deep(.el-table tr.pathway-row-pryer:hover > td.el-table__cell) {
  background-color: transparent !important;
}

.add-extra {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  align-items: center;
}

.remove-extra {
  margin-left: auto;
}

.drawer-actions {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: var(--space-2) 0 var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.recent-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}

.recent-date {
  color: var(--color-text-muted);
  width: 96px;
  flex-shrink: 0;
}

.recent-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
