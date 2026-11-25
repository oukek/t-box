import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { workspaceSources } from '../../../scripts/vite-workspace.mjs'

export default defineConfig({
  plugins: [workspaceSources(), vue()],
  base: './',
  build: { target: 'es2022' },
})
