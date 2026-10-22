import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { verifiedOffline } from '../../../scripts/vite-offline.mjs'
import { workspaceSources } from '../../../scripts/vite-workspace.mjs'

export default defineConfig({
  plugins: [workspaceSources(), vue(), verifiedOffline({ application: true })],
  base: './',
  build: { target: 'es2022' },
})
