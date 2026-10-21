<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile, UploadFiles, UploadRawFile, UploadUserFile } from 'element-plus'
import {
  createMember,
  exportMembersCsv,
  fetchMembers,
  removeMember,
  updateMember,
} from '@/api/members'
import { commitOcrImport, parseOcrImages } from '@/api/ocr'
import type { Member, MemberInput } from '@/types/member'
import type { OcrCandidate } from '@/types/ocr'

const OCR_MAX_FILES = 12
/** 结果表可视高度：只滚表格，上传区保持固定 */
const ocrTableMaxHeight = Math.round(Math.min(window.innerHeight * 0.38, 380))

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

const TITLE_OPTIONS = ['会长', '副会长', '外交官', '俱乐部之星', '正式会员', '骨干', '成员', '候补']

const ocrVisible = ref(false)
const ocrParsing = ref(false)
const ocrCommitting = ref(false)
const ocrJobId = ref('')
const ocrTip = ref('')
const ocrRows = ref<OcrCandidate[]>([])
const ocrFileList = ref<File[]>([])
const ocrUploadList = ref<UploadUserFile[]>([])

const ocrSelectedCount = computed(() => ocrRows.value.filter((r) => r.selected).length)
const ocrCreateCount = computed(
  () => ocrRows.value.filter((r) => r.selected && r.action === 'create').length,
)
const ocrUpdateCount = computed(
  () => ocrRows.value.filter((r) => r.selected && r.action === 'update').length,
)

function syncOcrFilesFromUpload(files: UploadUserFile[]) {
  ocrUploadList.value = files.slice(0, OCR_MAX_FILES)
  ocrFileList.value = ocrUploadList.value
    .map((f) => f.raw)
    .filter((f): f is UploadRawFile => Boolean(f))
}

function appendOcrFiles(files: File[]) {
  const room = OCR_MAX_FILES - ocrUploadList.value.length
  if (room <= 0) {
    ElMessage.warning(`最多 ${OCR_MAX_FILES} 张截图`)
    return 0
  }
  const take = files.slice(0, room)
  const base = Date.now()
  for (let i = 0; i < take.length; i++) {
    const file = take[i]
    const raw = file as UploadRawFile
    raw.uid = base + i
    ocrUploadList.value.push({
      name: file.name,
      uid: raw.uid,
      status: 'ready',
      raw,
    })
  }
  syncOcrFilesFromUpload(ocrUploadList.value)
  if (take.length < files.length) {
    ElMessage.warning(`已达上限 ${OCR_MAX_FILES} 张，多余图片未加入`)
  }
  return take.length
}

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
    characterName: row.characterName ?? '',
    powerScore: Number(row.powerScore) || 0,
    fashionScore: Number(row.fashionScore) || 0,
    pathway: row.pathway ?? '',
    title: row.title ?? '成员',
    remark: row.remark ?? '',
  })
  dialogVisible.value = true
}

function buildPayload(): MemberInput {
  return {
    characterName: String(form.characterName ?? '').trim(),
    powerScore: Number(form.powerScore) || 0,
    fashionScore: Number(form.fashionScore) || 0,
    pathway: String(form.pathway ?? '').trim(),
    title: String(form.title ?? '').trim() || '成员',
    remark: String(form.remark ?? '').trim(),
  }
}

async function save() {
  try {
    const payload = buildPayload()
    if (!payload.characterName) {
      ElMessage.warning('请填写角色名')
      return
    }
    if (editingId.value) {
      await updateMember(editingId.value, payload)
      ElMessage.success('已更新')
    } else {
      await createMember(payload)
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

function openOcr() {
  ocrVisible.value = true
  ocrJobId.value = ''
  ocrTip.value = ''
  ocrRows.value = []
  ocrFileList.value = []
  ocrUploadList.value = []
}

function onOcrFileChange(_file: UploadFile, files: UploadFiles) {
  syncOcrFilesFromUpload(files)
}

function onOcrFileRemove(_file: UploadFile, files: UploadFiles) {
  syncOcrFilesFromUpload(files)
}

function isEditablePasteTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

async function onOcrPaste(e: ClipboardEvent) {
  if (!ocrVisible.value || ocrParsing.value || ocrCommitting.value) return
  // 预览表里改角色名时允许正常粘贴文字
  if (isEditablePasteTarget(e.target)) return

  const items = e.clipboardData?.items
  if (!items?.length) return

  const images: File[] = []
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    images.push(
      new File([file], `粘贴截图-${Date.now()}-${images.length + 1}.${ext}`, {
        type: file.type || 'image/png',
      }),
    )
  }
  if (!images.length) return

  e.preventDefault()
  const added = appendOcrFiles(images)
  if (!added) return
  ElMessage.success(`已粘贴 ${added} 张，开始识别…`)
  await runOcrParse()
}

watch(ocrVisible, (open) => {
  if (open) window.addEventListener('paste', onOcrPaste)
  else window.removeEventListener('paste', onOcrPaste)
})

async function runOcrParse() {
  if (!ocrFileList.value.length) {
    ElMessage.warning('请先选择或粘贴截图')
    return
  }
  ocrParsing.value = true
  try {
    const data = await parseOcrImages(ocrFileList.value)
    ocrJobId.value = data.jobId
    ocrTip.value = data.tip || ''
    ocrRows.value = data.candidates.map((c) => ({ ...c }))
    ElMessage.success(`识别到 ${data.candidates.length} 行，请核对后导入`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '识别失败')
  } finally {
    ocrParsing.value = false
  }
}

async function runOcrCommit() {
  if (!ocrJobId.value) {
    ElMessage.warning('请先识别截图')
    return
  }
  if (!ocrSelectedCount.value) {
    ElMessage.warning('请至少勾选一行')
    return
  }
  const empty = ocrRows.value.find((r) => r.selected && !String(r.characterName || '').trim())
  if (empty) {
    ElMessage.warning('勾选行存在空角色名，请补全或取消勾选')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将导入 ${ocrSelectedCount.value} 行（新增 ${ocrCreateCount.value} / 更新 ${ocrUpdateCount.value}）。确认提交？`,
      '确认导入',
      { type: 'warning' },
    )
  } catch {
    return
  }
  ocrCommitting.value = true
  try {
    const data = await commitOcrImport(
      ocrJobId.value,
      ocrRows.value.map((r) => ({
        characterName: String(r.characterName || '').trim(),
        title: String(r.title || '').trim() || '成员',
        pathway: String(r.pathway || '').trim() || '未填写',
        powerScore: Number(r.powerScore) || 0,
        fashionScore: Number(r.fashionScore) || 0,
        selected: Boolean(r.selected),
      })),
    )
    ElMessage.success(
      `导入完成：新增 ${data.created.length}，更新 ${data.updated.length}` +
        (data.skipped.length ? `，跳过 ${data.skipped.length}` : ''),
    )
    ocrVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导入失败')
  } finally {
    ocrCommitting.value = false
  }
}

onMounted(load)
onUnmounted(() => window.removeEventListener('paste', onOcrPaste))
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">成员列表</h2>
        <p class="page-desc">手动录入 / 编辑，或从游戏「俱乐部成员列表」截图识别导入。</p>
      </div>
      <div class="actions">
        <el-button @click="onExport">导出 CSV</el-button>
        <el-button @click="openOcr">从截图导入</el-button>
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
      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        table-layout="fixed"
        style="width: 100%"
        empty-text="暂无成员"
      >
        <el-table-column prop="characterName" label="角色名" min-width="1" />
        <el-table-column prop="powerScore" label="非凡评分" min-width="1" sortable />
        <el-table-column prop="fashionScore" label="风尚度" min-width="1" />
        <el-table-column prop="pathway" label="序列/途径" min-width="1" show-overflow-tooltip />
        <el-table-column prop="title" label="职位" min-width="1" />
        <el-table-column prop="remark" label="备注" min-width="1" show-overflow-tooltip />
        <el-table-column label="操作" min-width="1">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="onDelete(row)">移出</el-button>
            </div>
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

    <el-dialog
      v-model="ocrVisible"
      title="从截图导入"
      width="960px"
      top="4vh"
      destroy-on-close
      class="ocr-dialog"
    >
      <div class="ocr-dialog-body">
        <div class="ocr-dialog-fixed">
          <p class="ocr-hint">
            上传游戏内「俱乐部成员列表」截图（可多张翻页）。可用：选择文件 / 拖拽 /
            <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴（粘贴后自动识别）。识别后请核对角色名（头像旁易缺字），勾选行再确认导入。
          </p>
          <div class="ocr-upload">
            <el-upload
              v-model:file-list="ocrUploadList"
              drag
              multiple
              accept="image/png,image/jpeg,image/webp,image/bmp"
              :auto-upload="false"
              :limit="OCR_MAX_FILES"
              :on-change="onOcrFileChange"
              :on-remove="onOcrFileRemove"
              :disabled="ocrParsing || ocrCommitting"
            >
              <div class="ocr-upload-text">拖拽 / 点击选择，或直接 Ctrl+V 粘贴截图</div>
              <div class="ocr-upload-sub">支持 PNG / JPG，单次最多 {{ OCR_MAX_FILES }} 张；粘贴后自动开始识别</div>
            </el-upload>
            <el-button
              type="primary"
              :loading="ocrParsing"
              :disabled="!ocrFileList.length || ocrCommitting"
              @click="runOcrParse"
            >
              开始识别
            </el-button>
          </div>
          <p v-if="ocrTip" class="ocr-tip">{{ ocrTip }}</p>
        </div>

        <div v-if="ocrRows.length" class="ocr-dialog-results">
          <p class="ocr-summary">
            已选 {{ ocrSelectedCount }} 行 · 将新增 {{ ocrCreateCount }} · 将更新 {{ ocrUpdateCount }}
          </p>
          <el-table
            :data="ocrRows"
            size="small"
            :max-height="ocrTableMaxHeight"
            class="ocr-table"
            table-layout="fixed"
          >
            <el-table-column width="52" align="center">
              <template #default="{ row }">
                <el-checkbox v-model="row.selected" />
              </template>
            </el-table-column>
            <el-table-column label="角色名" min-width="140">
              <template #default="{ row }">
                <el-input
                  v-model="row.characterName"
                  size="small"
                  :class="{ 'is-warn': row.lowConfidence || row.characterName.length < 2 }"
                />
              </template>
            </el-table-column>
            <el-table-column label="职位" min-width="120">
              <template #default="{ row }">
                <el-select v-model="row.title" size="small" filterable allow-create style="width: 100%">
                  <el-option v-for="t in TITLE_OPTIONS" :key="t" :label="t" :value="t" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="途径" min-width="100">
              <template #default="{ row }">
                <el-input v-model="row.pathway" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="非凡评分" min-width="110">
              <template #default="{ row }">
                <el-input-number v-model="row.powerScore" size="small" :min="0" controls-position="right" style="width: 100%" />
              </template>
            </el-table-column>
            <el-table-column label="风尚度" min-width="110">
              <template #default="{ row }">
                <el-input-number v-model="row.fashionScore" size="small" :min="0" controls-position="right" style="width: 100%" />
              </template>
            </el-table-column>
            <el-table-column label="动作" width="72" align="center">
              <template #default="{ row }">
                <span :class="row.action === 'update' ? 'tag-update' : 'tag-create'">
                  {{ row.action === 'update' ? '更新' : '新增' }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <template #footer>
        <el-button :disabled="ocrParsing || ocrCommitting" @click="ocrVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="ocrCommitting"
          :disabled="!ocrRows.length || ocrParsing"
          @click="runOcrCommit"
        >
          确认导入
        </el-button>
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
  color: var(--color-brand-hover);
  letter-spacing: 0.04em;
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
  background: var(--color-surface-glass);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm), inset 0 1px 0 var(--color-inset-highlight);
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
  overflow: visible;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: nowrap;
  line-height: 1.4;
}

.ocr-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: calc(92vh - 148px);
  min-height: 0;
}

.ocr-dialog-fixed {
  flex: 0 0 auto;
}

.ocr-dialog-results {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  overflow: hidden;
}

.ocr-hint,
.ocr-tip,
.ocr-summary {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
}

.ocr-hint {
  margin-bottom: var(--space-3);
}

.ocr-tip {
  color: var(--color-warning);
}

.ocr-summary {
  color: var(--color-text-secondary);
}

.ocr-upload {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ocr-upload-text {
  color: var(--color-text);
  font-size: var(--font-size-md);
}

.ocr-upload-sub {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.ocr-hint kbd {
  display: inline-block;
  padding: 0 0.35em;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-size: 0.92em;
  font-family: inherit;
}

.ocr-table :deep(.is-warn .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--color-danger) inset;
}

.tag-create {
  color: var(--color-success);
  font-size: var(--font-size-sm);
}

.tag-update {
  color: var(--color-brand);
  font-size: var(--font-size-sm);
}
</style>
