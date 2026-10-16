import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { verifiedOffline } from '../../../scripts/vite-offline.mjs'

export default defineConfig({
  plugins: [vue(), verifiedOffline({ application: true })],
  base: './',
  server: {
    fs: {
      deny: ['**/.env', '**/.env.*', '**/*.{pem,key}', '**/.secrets/**'],
    },
  },
})
