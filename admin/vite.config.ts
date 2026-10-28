import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { workspaceSources } from '../scripts/vite-workspace.mjs'

export default defineConfig({
  plugins: [workspaceSources(), vue()],
  server: {
    fs: {
      deny: [
        '**/.env',
        '**/.env.*',
        '**/*.{crt,pem}',
        '**/.git/**',
        '**/.secrets/**',
      ],
    },
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:6868' },
  },
  build: { outDir: 'dist', target: 'es2022' },
})
