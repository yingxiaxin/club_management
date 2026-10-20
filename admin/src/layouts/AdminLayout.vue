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
        <router-link class="nav-item" to="/members">成员花名册</router-link>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">P0 管理后台</div>
        <div class="topbar-user">
          <span>{{ user?.displayName || user?.username }}</span>
          <el-button text type="primary" @click="logout">退出</el-button>
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
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--space-5) var(--space-4);
}

.brand {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: var(--space-5);
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

.nav-item.router-link-active {
  background: var(--color-brand-muted);
  color: var(--color-brand);
  font-weight: 600;
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
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
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

.content {
  padding: var(--space-5);
}
</style>
