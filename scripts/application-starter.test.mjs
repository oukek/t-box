import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { discoverApplications } from './application-builds.mjs'
import { createApplication } from './create-application.mjs'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
test('new independent app scaffold compiles contracts, server and Vue web app and is discoverable by manual release tooling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-template-'))
  try {
    await mkdir(join(root, 'apps'))
    await symlink(join(workspace, 'scripts'), join(root, 'scripts'))
    const app = await createApplication(root, 'fixture-app', 5188)
    assert.equal((await discoverApplications(root))[0].appId, 'fixture-app')
    await assert.rejects(createApplication(root, '../escape'), /Usage/)
    await assert.rejects(createApplication(root, 'fixture-app'), /exist/)
    const link = async (layer, name, target) => {
      const path = join(app, layer, 'node_modules', name)
      await mkdir(dirname(path), { recursive: true })
      await symlink(target, path)
    }
    for (const [layer, deps] of Object.entries({
      contracts: { '@t-box/app-contracts': 'packages/app-contracts' },
      server: { '@t-box/app-server-sdk': 'packages/app-server-sdk', '@t-box/app-contracts': 'packages/app-contracts' },
      web: { '@t-box/app-sdk': 'packages/app-sdk', '@t-box/app-web-sdk': 'packages/app-web-sdk', 'vue': 'app/node_modules/vue', 'vite': 'app/node_modules/vite', '@vitejs/plugin-vue': 'app/node_modules/@vitejs/plugin-vue' },
    })) {
      for (const [name, target] of Object.entries(deps)) {
        await link(layer, name, join(workspace, target))
      }
      if (layer !== 'contracts') {
        await link(layer, '@t-box/fixture-app-contracts', join(app, 'contracts'))
      }
    }
    const tsc = require.resolve('typescript/bin/tsc')
    for (const layer of ['contracts', 'server']) {
      execFileSync(process.execPath, [tsc, '-p', join(app, layer, 'tsconfig.json')], { cwd: root, stdio: 'pipe' })
    }
    execFileSync(process.execPath, [join(workspace, 'app/node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', join(app, 'web/tsconfig.json')], { cwd: root, stdio: 'pipe' })
    execFileSync(process.execPath, [join(workspace, 'app/node_modules/vite/bin/vite.js'), 'build', join(app, 'web'), '--config', join(app, 'web/vite.config.ts')], { cwd: root, stdio: 'pipe' })
    assert.ok((await readFile(join(app, 'web/dist/index.html'), 'utf8')).includes('/assets/'))
    const source = await readFile(join(app, 'web/src/main.ts'), 'utf8')
    assert.equal(source.includes('Bearer'), false)
    assert.ok(source.includes('fixture_app_focus'))
    assert.ok((await readFile(join(app, 'server/src/index.ts'), 'utf8')).includes('execution: \'server\''))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
