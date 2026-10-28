import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { developmentApplicationStatus } from '../scripts/vite-development-apps.mjs'
import { localApplicationDeclarations } from '../scripts/vite-local-applications.mjs'
import { verifiedOffline } from '../scripts/vite-offline.mjs'
import { workspaceSources } from '../scripts/vite-workspace.mjs'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)

export default defineConfig({
  plugins: [workspaceSources(), vue(), verifiedOffline(), developmentApplicationStatus(fileURLToPath(new URL('..', import.meta.url))), localApplicationDeclarations(fileURLToPath(new URL('..', import.meta.url)))],
  define: { __APP_VERSION__: JSON.stringify(version) },
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
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:6868', ws: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
