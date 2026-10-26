<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createInviteCode,
  fetchInviteCodes,
  fetchJoinApplications,
  reviewJoinApplication,
  updateInviteCode,
  type InviteCode,
  type JoinApplication,
} from '@/api/invites'

const loading = ref(false)
const invites = ref<InviteCode[]>([])
const apps = ref<JoinApplication[]>([])
const appFilter = ref<'pending' | 'all'>('pending')

const form = reactive({
  code: '',
  maxUses: 50,
  expiresAt: null as Date | null,
})

async function load() {
  loading.value = true
  try {
    const [codes, applications] = await Promise.all([
      fetchInviteCodes(),
      fetchJoinApplications(appFilter.value === 'pending' ? 'pending' : undefined),
    ])
    invites.value = codes
    apps.value = applications
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  try {
    await createInviteCode({
      code: form.code.trim() || undefined,
      maxUses: form.maxUses,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    })
    form.code = ''
    form.expiresAt = null
    ElMessage.success('已创建邀请码')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  }
}

async function toggleEnabled(row: InviteCode) {
  try {
    await updateInviteCode(row.id, { enabled: !row.enabled })
    ElMessage.success(row.enabled ? '已停用' : '已启用')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '更新失败')
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success('已复制邀请码')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

async function onReview(row: JoinApplication, decision: 'approved' | 'rejected') {
  try {
    await reviewJoinApplication(row.id, decision)
    ElMessage.success(decision === 'approved' ? '已通过' : '已拒绝')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
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
    <section class="block invites-block">
      <header class="head">
        <h2>邀请码</h2>
        <p class="sub">
          发给已在名单中的成员：小程序填邀请码 + 角色名（须与名单一致）→ 管理员确认后关联微信。不新建成员。
        </p>
      </header>

      <el-form class="create" inline @submit.prevent="onCreate">
        <el-form-item label="自定义码">
          <el-input v-model="form.code" placeholder="可空，自动生成" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item label="次数上限">
          <el-input-number v-model="form.maxUses" :min="1" :max="9999" />
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            placeholder="可选"
            clearable
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit">生成邀请码</el-button>
        </el-form-item>
      </el-form>

      <div class="table-wrap">
        <el-table
          :data="invites"
          stripe
          empty-text="暂无邀请码"
          table-layout="fixed"
          height="100%"
          style="width: 100%"
        >
          <el-table-column prop="code" label="邀请码" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <button class="linkish" type="button" @click="copyCode(row.code)">{{ row.code }}</button>
            </template>
          </el-table-column>
          <el-table-column label="使用" width="100">
            <template #default="{ row }">{{ row.usedCount }} / {{ row.maxUses }}</template>
          </el-table-column>
          <el-table-column label="过期" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ formatTime(row.expiresAt) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span :class="row.enabled ? 'ok' : 'off'">{{ row.enabled ? '启用' : '停用' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" min-width="120" fixed="right">
            <template #default="{ row }">
              <el-button text type="primary" @click="toggleEnabled(row)">
                {{ row.enabled ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="block apps-block">
      <header class="head row">
        <div>
          <h2>关联申请</h2>
          <p class="sub">通过后把申请人微信绑定到已有角色；匹配不上名单的申请在提交时已被拒绝。</p>
        </div>
        <el-radio-group v-model="appFilter" size="small" @change="load">
          <el-radio-button label="pending">待审</el-radio-button>
          <el-radio-button label="all">全部</el-radio-button>
        </el-radio-group>
      </header>

      <div class="table-wrap">
        <el-table
          :data="apps"
          stripe
          empty-text="暂无申请"
          table-layout="fixed"
          height="100%"
          style="width: 100%"
        >
          <el-table-column prop="characterName" label="角色名" min-width="120" show-overflow-tooltip />
          <el-table-column prop="pathway" label="途径" min-width="100" show-overflow-tooltip />
          <el-table-column prop="inviteCode" label="邀请码" width="120" show-overflow-tooltip />
          <el-table-column prop="remark" label="留言" min-width="140" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span v-if="row.status === 'pending'" class="warn">待审</span>
              <span v-else-if="row.status === 'approved'" class="ok">已通过</span>
              <span v-else class="off">已拒绝</span>
            </template>
          </el-table-column>
          <el-table-column label="申请时间" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" min-width="180" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-button text type="primary" @click="onReview(row, 'approved')">通过</el-button>
                <el-button text type="danger" @click="onReview(row, 'rejected')">拒绝</el-button>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  height: calc(100vh - var(--header-height) - 2 * var(--space-5));
  min-height: 360px;
  overflow: hidden;
}

.block {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 邀请码区略矮于关联申请（约 4:5） */
.invites-block {
  flex: 4 1 0;
}

.apps-block {
  flex: 5 1 0;
}

.table-wrap {
  flex: 1;
  min-height: 120px;
  overflow: hidden;
}

.head {
  flex-shrink: 0;
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
}

.sub {
  margin: 0 0 var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.apps-block .sub {
  margin-bottom: 0;
}

.create {
  margin-bottom: var(--space-4);
  flex-shrink: 0;
}

.linkish {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-brand);
  cursor: pointer;
  font: inherit;
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
</style>
