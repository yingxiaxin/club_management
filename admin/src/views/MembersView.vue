<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createMember,
  exportMembersCsv,
  fetchMembers,
  removeMember,
  updateMember,
} from '@/api/members'
import type { Member, MemberInput } from '@/types/member'

const loading = ref(false)
const rows = ref<Member[]>([])
const query = reactive({
  q: '',
  pathway: '',
  title: '',
  sort: 'powerScore',
  order: 'desc',
})

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const form = reactive<MemberInput>({
  characterName: '',
  powerScore: 0,
  fashionScore: 0,
  pathway: '',
  title: '成员',
  remark: '',
})

const TITLE_OPTIONS = ['会长', '副会长', '骨干', '成员']

async function load() {
  loading.value = true
  try {
    const params: Record<string, string> = {
      sort: query.sort,
      order: query.order,
    }
    if (query.q.trim()) params.q = query.q.trim()
    if (query.pathway.trim()) params.pathway = query.pathway.trim()
    if (query.title.trim()) params.title = query.title.trim()
    rows.value = await fetchMembers(params)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    characterName: '',
    powerScore: 0,
    fashionScore: 0,
    pathway: '',
    title: '成员',
    remark: '',
  })
  dialogVisible.value = true
}

function openEdit(row: Member) {
  editingId.value = row.id
  Object.assign(form, {
    characterName: row.characterName,
    powerScore: row.powerScore,
    fashionScore: row.fashionScore,
    pathway: row.pathway,
    title: row.title,
    remark: row.remark,
  })
  dialogVisible.value = true
}

async function save() {
  try {
    if (!form.characterName.trim()) {
      ElMessage.warning('请填写角色名')
      return
    }
    if (editingId.value) {
      await updateMember(editingId.value, form)
      ElMessage.success('已更新')
    } else {
      await createMember(form)
      ElMessage.success('已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

async function onDelete(row: Member) {
  try {
    await ElMessageBox.confirm(`确认将「${row.characterName}」移出俱乐部？`, '删除确认', {
      type: 'warning',
    })
    await removeMember(row.id)
    ElMessage.success('已移出')
    await load()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function onExport() {
  try {
    const blob = await exportMembersCsv()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'members.csv'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">成员花名册</h2>
        <p class="page-desc">手动录入 / 编辑。截图 OCR 导入将在 P0-ocr 提供。</p>
      </div>
      <div class="actions">
        <el-button @click="onExport">导出 CSV</el-button>
        <el-button type="primary" @click="openCreate">新增成员</el-button>
      </div>
    </div>

    <div class="filters card">
      <el-input v-model="query.q" clearable placeholder="搜索角色名 / 途径 / 备注" class="filter-item" />
      <el-input v-model="query.pathway" clearable placeholder="途径筛选" class="filter-item" />
      <el-select v-model="query.title" clearable placeholder="职位" class="filter-item">
        <el-option v-for="t in TITLE_OPTIONS" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="query.sort" class="filter-item">
        <el-option label="按非凡评分" value="powerScore" />
        <el-option label="按风尚度" value="fashionScore" />
        <el-option label="按角色名" value="characterName" />
        <el-option label="按入会时间" value="joinedAt" />
      </el-select>
      <el-select v-model="query.order" class="filter-item narrow">
        <el-option label="降序" value="desc" />
        <el-option label="升序" value="asc" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="card table-wrap">
      <el-table v-loading="loading" :data="rows" stripe empty-text="暂无成员">
        <el-table-column prop="characterName" label="角色名" min-width="120" />
        <el-table-column prop="powerScore" label="非凡评分" width="110" sortable />
        <el-table-column prop="fashionScore" label="风尚度" width="100" />
        <el-table-column prop="pathway" label="序列/途径" min-width="120" />
        <el-table-column prop="title" label="职位" width="100" />
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="onDelete(row)">移出</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑成员' : '新增成员'"
      width="520px"
      destroy-on-close
    >
      <el-form label-width="96px">
        <el-form-item label="角色名" required>
          <el-input v-model="form.characterName" maxlength="40" />
        </el-form-item>
        <el-form-item label="非凡评分">
          <el-input-number v-model="form.powerScore" :min="0" :step="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="风尚度">
          <el-input-number v-model="form.fashionScore" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="序列/途径">
          <el-input v-model="form.pathway" placeholder="如：愚者途径" />
        </el-form-item>
        <el-form-item label="职位">
          <el-select v-model="form.title" style="width: 100%">
            <el-option v-for="t in TITLE_OPTIONS" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.page-title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

.page-desc {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}

.filter-item {
  width: 180px;
}

.filter-item.narrow {
  width: 110px;
}

.table-wrap {
  padding: var(--space-2);
}
</style>
