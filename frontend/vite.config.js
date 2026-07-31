import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'BookFlow 小说阅读器',
        short_name: 'BookFlow',
        theme_color: '#4f46e5',
      }
    })
  ],
  server: {
    port: 3000,
    headers: {
      'Permissions-Policy': 'unload=()',
    },
    proxy: {
      '/api': 'http://localhost:3001',
      '/covers': 'http://localhost:3001'
    }
  },
  optimizeDeps: {
    include: ['epubjs', 'pdfjs-dist']
  }
})
