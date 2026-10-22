import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn } from '@/auth/session'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      children: [
        { path: '', redirect: '/members' },
        {
          path: 'members',
          name: 'members',
          component: () => import('@/views/MembersView.vue'),
        },
        {
          path: 'invites',
          name: 'invites',
          component: () => import('@/views/InvitesView.vue'),
        },
        {
          path: 'activities',
          name: 'activities',
          component: () => import('@/views/ActivitiesView.vue'),
        },
        {
          path: 'reminders',
          name: 'reminders',
          component: () => import('@/views/RemindersView.vue'),
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!isLoggedIn()) return { name: 'login', query: { redirect: to.fullPath } }
  return true
})

export default router
