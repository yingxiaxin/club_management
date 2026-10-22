<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { clearAuth, getUser } from '@/auth/session'

const router = useRouter()
const user = computed(() => getUser())

function logout() {
  clearAuth()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">俱乐部管理</div>
      <nav class="nav">
        <router-link class="nav-item" to="/members">成员列表</router-link>
        <router-link class="nav-item" to="/invites">邀请码 / 入会</router-link>
        <router-link class="nav-item" to="/activities">活动日程</router-link>
        <router-link class="nav-item" to="/reminders">提醒设置</router-link>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">俱乐部管理后台</div>
        <div class="topbar-user">
          <span>{{ user?.displayName || user?.username }}</span>
          <el-button class="logout-btn" text type="primary" @click="logout">退出</el-button>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  width: var(--sidebar-width);
  background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg) 100%);
  border-right: 1px solid var(--color-border-strong);
  padding: var(--space-5) var(--space-4);
  box-shadow: inset -1px 0 0 var(--color-inset-highlight);
}

.brand {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-brand-hover);
  letter-spacing: 0.04em;
  margin-bottom: var(--space-5);
  text-shadow: 0 0 24px var(--color-brand-glow);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.nav-item {
  text-decoration: none;
  color: var(--color-text-secondary);
  padding: var(--space-3) var(--space-3);
  border-radius: var(--radius-sm);
}

.nav-item:hover {
  color: var(--color-text);
  background: var(--color-brand-muted);
}

.nav-item.router-link-active {
  background: var(--color-brand-muted);
  color: var(--color-brand-hover);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--color-brand);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-5);
  background: var(--color-surface-topbar);
  border-bottom: 1px solid var(--color-border);
  backdrop-filter: blur(8px);
}

.topbar-title {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
}

.topbar-user {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text);
}

.logout-btn {
  color: var(--color-brand-hover) !important;
  font-weight: 600;
}

.logout-btn:hover {
  color: var(--color-brand) !important;
}

.content {
  padding: var(--space-5);
}
</style>
