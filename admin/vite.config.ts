import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3789',
        changeOrigin: true,
        // OCR 识别可能数十秒；避免代理中途掐断导致 ECONNRESET
        timeout: 180_000,
        proxyTimeout: 180_000,
      },
    },
  },
})
