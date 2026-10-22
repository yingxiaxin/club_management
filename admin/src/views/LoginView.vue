<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { loginWithPassword, pollQrLogin, startQrLogin, type QrStart } from '@/api/auth'
import { setAuth } from '@/auth/session'

const router = useRouter()
const route = useRoute()

const qr = ref<QrStart | null>(null)
const qrLoading = ref(false)
const qrError = ref('')
const qrStatus = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const emergencyOpen = ref<string[]>([])
const emergencyLoading = ref(false)
const form = reactive({
  username: 'superadmin',
  password: 'club-change-me',
})

function goIn(token: string, user: { username: string; role: string; displayName: string }) {
  setAuth(token, user)
  ElMessage.success('登录成功')
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/members'
  router.replace(redirect)
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function refreshQr() {
  stopPoll()
  qrLoading.value = true
  qrError.value = ''
  qrStatus.value = ''
  qr.value = null
  try {
    const data = await startQrLogin()
    qr.value = data
    qrStatus.value = '等待手机确认…'
    pollTimer = setInterval(async () => {
      if (!qr.value?.ticketId) return
      try {
        const st = await pollQrLogin(qr.value.ticketId)
        if (st.status === 'confirmed' && 'token' in st) {
          stopPoll()
          goIn(st.token, {
            username: st.username,
            role: st.role,
            displayName: st.displayName,
          })
        } else if (st.status === 'expired') {
          stopPoll()
          qrStatus.value = '已过期'
          qrError.value = '二维码已过期，请点击刷新'
        } else if (st.status === 'pending') {
          qrStatus.value = '等待手机确认…'
        }
      } catch (e) {
        stopPoll()
        qrError.value = e instanceof Error ? e.message : '轮询失败'
      }
    }, 2000)
  } catch (e) {
    qrError.value = e instanceof Error ? e.message : '无法创建扫码登录'
  } finally {
    qrLoading.value = false
  }
}

async function copyTicket() {
  const id = qr.value?.ticketId
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('票号已复制')
  } catch {
    ElMessage.info(id)
  }
}

async function onEmergencySubmit() {
  emergencyLoading.value = true
  try {
    const data = await loginWithPassword(form.username, form.password)
    goIn(data.token, {
      username: data.username,
      role: data.role,
      displayName: data.displayName,
    })
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    emergencyLoading.value = false
  }
}

onMounted(() => {
  void refreshQr()
})

onUnmounted(() => {
  stopPoll()
})
</script>

<template>
  <div class="login-page">
    <div class="panel">
      <h1 class="title">俱乐部管理后台</h1>
      <p class="hint">微信扫码登录（管理员）</p>

      <div class="qr-box">
        <div v-if="qrLoading" class="qr-placeholder">正在创建登录票…</div>
        <img v-else-if="qr?.qrBase64" class="qr-img" :src="qr.qrBase64" alt="登录小程序码" />
        <p v-if="qr?.qrBase64" class="qr-tip">
          若提示「开发版已过期」：先在开发者工具点「预览」用手机扫一次，再扫本码；或上传体验版后把
          <code>CLOUD_QR_ENV_VERSION=trial</code> 并重启 API。
        </p>
        <div v-else class="qr-fallback">
          <p class="fallback-title">当前环境无法出小程序码</p>
          <p class="ticket" v-if="qr?.ticketId">
            票号 <strong>{{ qr.ticketId }}</strong>
          </p>
          <el-button v-if="qr?.ticketId" size="small" @click="copyTicket">复制票号</el-button>
          <ol class="steps">
            <li>开发者工具打开「管理端扫码登录」页</li>
            <li>粘贴票号 → 点「确认登录管理端」</li>
            <li>回到本页，应自动进入后台</li>
          </ol>
          <p v-if="qrError" class="err">{{ qrError }}</p>
        </div>
        <p v-if="qrStatus" class="status">{{ qrStatus }}</p>
        <el-button class="refresh" :loading="qrLoading" @click="refreshQr">刷新登录票</el-button>
      </div>

      <el-collapse v-model="emergencyOpen" class="emergency">
        <el-collapse-item title="应急账号密码登录" name="1">
          <el-form label-position="top" @submit.prevent="onEmergencySubmit">
            <el-form-item label="账号">
              <el-input v-model="form.username" autocomplete="username" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                autocomplete="current-password"
              />
            </el-form-item>
            <el-button type="primary" class="submit" :loading="emergencyLoading" native-type="submit">
              应急登录
            </el-button>
          </el-form>
          <p class="tip">默认：superadmin / club-change-me（仅防微信号换绑）</p>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
}

.panel {
  width: min(420px, 100%);
  background: linear-gradient(165deg, var(--color-surface) 0%, var(--color-bg) 100%);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md), 0 0 48px var(--color-brand-glow);
  padding: var(--space-6);
}

.title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xl);
  color: var(--color-brand-hover);
  letter-spacing: 0.06em;
}

.hint,
.tip,
.status,
.err,
.ticket,
.tip-inline {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-4) 0;
}

.qr-img {
  width: 220px;
  height: 220px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: #fff;
}

.qr-tip {
  margin: 0;
  max-width: 280px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
  text-align: center;
}

.qr-tip code {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.qr-placeholder,
.qr-fallback {
  width: 100%;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  text-align: center;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px dashed var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  box-sizing: border-box;
}

.fallback-title {
  margin: 0;
  color: var(--color-text);
}

.ticket strong {
  color: var(--color-brand-hover);
  font-size: var(--font-size-md);
  letter-spacing: 0.04em;
}

.steps {
  margin: var(--space-2) 0 0;
  padding-left: 1.2em;
  text-align: left;
  line-height: 1.6;
}

.status {
  color: var(--color-brand);
}

.err {
  color: var(--color-danger, #c45c4a);
  text-align: center;
}

.refresh {
  width: 100%;
}

.emergency {
  margin-top: var(--space-4);
  border: none;
  --el-collapse-header-bg-color: transparent;
  --el-collapse-content-bg-color: transparent;
}

.submit {
  width: 100%;
}

.tip {
  margin-top: var(--space-3);
}
</style>
