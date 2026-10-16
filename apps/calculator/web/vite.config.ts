import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { verifiedOffline } from '../../../scripts/vite-offline.mjs'

export default defineConfig({
  plugins: [vue(), verifiedOffline({ application: true })],
  base: './',
  build: { target: 'es2022' },
  server: {
    headers: { 'Referrer-Policy': 'strict-origin-when-cross-origin' },
    fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.secrets/**'] },
  },
})
