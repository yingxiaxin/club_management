<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { login } from '@/api/members'
import { setAuth } from '@/auth/session'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const form = reactive({
  username: 'superadmin',
  password: 'club-change-me',
})

async function onSubmit() {
  loading.value = true
  try {
    const data = await login(form.username, form.password)
    setAuth(data.token, {
      username: data.username,
      role: data.role,
      displayName: data.displayName,
    })
    ElMessage.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/members'
    router.replace(redirect)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="panel">
      <h1 class="title">俱乐部管理后台</h1>
      <p class="hint">P0 应急账号登录（后续接微信扫码）</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="账号">
          <el-input v-model="form.username" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" native-type="submit">
          登录
        </el-button>
      </el-form>
      <p class="tip">默认：superadmin / club-change-me</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background:
    radial-gradient(1200px 500px at 10% -10%, var(--color-brand-muted), transparent 60%),
    var(--color-bg);
}

.panel {
  width: min(420px, 100%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
}

.title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

.hint,
.tip {
  margin: 0 0 var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.submit {
  width: 100%;
}

.tip {
  margin-top: var(--space-4);
  margin-bottom: 0;
}
</style>
