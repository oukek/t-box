import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createServer } from 'vite'
import { workspaceSources } from '../../scripts/vite-workspace.mjs'

test('workspace source imports work without any dist or node_modules links, including transitive and wildcard exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-source-only-'))
  const write = async (file: string, value: string) => {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), value)
  }
  await write('pnpm-workspace.yaml', 'packages:\n  - app\n  - packages/*\n')
  await write('app/package.json', JSON.stringify({ name: '@fixture/app', type: 'module', dependencies: { '@fixture/shared': 'workspace:*' } }))
  await write('app/src/main.ts', 'import { value } from "@fixture/shared"; console.log(value)')
  await write('packages/shared/package.json', JSON.stringify({ name: '@fixture/shared', dependencies: { '@fixture/units': 'workspace:*' }, exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
  await write('packages/shared/src/index.ts', 'export { value } from "@fixture/units/length"')
  await write('packages/units/package.json', JSON.stringify({ name: '@fixture/units', exports: { './*': { types: './dist/*.d.ts', import: './dist/*.js' } } }))
  await write('packages/units/src/length.ts', 'export const value: number = 100')
  // A stale compiled value must never enter a browser bundle.
  await write('packages/units/dist/length.js', 'export const value = "stale"')
  const server = await createServer({ configFile: false, root: join(root, 'app'), plugins: [workspaceSources({ root })], cacheDir: join(root, '.cache'), logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null } })
  try {
    const entry = await server.transformRequest('/src/main.ts')
    assert.ok(entry?.code.includes('/packages/shared/src/index.ts'))
    const transitive = await server.transformRequest('/@fs' + join(root, 'packages/shared/src/index.ts'))
    assert.ok(transitive?.code.includes('/packages/units/src/length.ts'))
    const unit = await server.transformRequest('/@fs' + join(root, 'packages/units/src/length.ts'))
    assert.ok(unit?.code.includes('100'))
    assert.doesNotMatch(unit!.code, /stale/)
    assert.equal(await server.environments.client.pluginContainer.resolveId('@fixture/shared/private'), null)
    await assert.rejects(server.environments.client.pluginContainer.resolveId('@fixture/units/length', join(root, 'app/src/main.ts')), /Undeclared workspace dependency/)
  } finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
