import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { parseSystemVersion } from '../packages/app-contracts/src/system-version'
import { developmentApplicationStatus } from '../scripts/vite-development-apps.mjs'
import { localApplicationDeclarations } from '../scripts/vite-local-applications.mjs'
import { verifiedOffline } from '../scripts/vite-offline.mjs'
import { workspaceSources } from '../scripts/vite-workspace.mjs'

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)

const version = process.env.TBOX_UI_VERSION ?? packageVersion
parseSystemVersion(version)

const shellRelease = process.env.TBOX_WEB_BUILD_ID ?? randomUUID()
if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(shellRelease)) {
  throw new Error('Invalid web build ID')
}

export default defineConfig(({ mode }) => ({
  plugins: [mode === 'desktop' && {
    name: 'desktop-ui-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'desktop-ui-version.json', source: JSON.stringify({ version, build: shellRelease }) })
    },
  }, workspaceSources(), vue(), mode !== 'desktop' && verifiedOffline({ shellRelease, uiVersion: version }), developmentApplicationStatus(fileURLToPath(new URL('..', import.meta.url))), localApplicationDeclarations(fileURLToPath(new URL('..', import.meta.url)))],
  define: { __WEB_BUILD_ID__: JSON.stringify(shellRelease), __APP_VERSION__: JSON.stringify(version) },
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
}))
