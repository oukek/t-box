import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const workspace = fileURLToPath(new URL('../../', import.meta.url))
test('Vite transforms workspace consumers of the shared errors package', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'tbox-vite-workspace-'))
  const server = await createServer({
    root: join(workspace, 'app'),
    configFile: join(workspace, 'app/vite.config.ts'),
    cacheDir: cache,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    for (const consumer of [
      'packages/app-contracts/dist/error-codes.js',
      'packages/app-web-sdk/dist/error-codes.js',
      'packages/app-shell-sdk/src/error-codes.ts',
    ]) {
      const file = join(workspace, consumer)
      const resolved =
        await server.environments.client.pluginContainer.resolveId(
          '@t-box/errors',
          file,
        )
      assert.equal(resolved?.id, join(workspace, 'packages/errors/src/index.ts'), consumer)
      const result = await server.transformRequest('/@fs' + file)
      assert.ok(result, consumer)
      assert.doesNotMatch(
        result.code,
        /from\s+['"]@t-box\/errors['"]/,
        'the browser must receive a resolved workspace module URL',
      )
    }
    const desktop = join(workspace, 'shared/dist/desktop.js')
    const converter = await server.environments.client.pluginContainer.resolveId('@t-box/converter-contracts', desktop)
    assert.equal(converter?.id, join(workspace, 'apps/converter/contracts/src/index.ts'))
    const desktopResult = await server.transformRequest('/@fs' + desktop)
    assert.ok(desktopResult)
    assert.doesNotMatch(desktopResult.code, /from\s+['"]@t-box\/converter-contracts['"]/)
  } finally {
    await server.close()
    await rm(cache, { recursive: true, force: true })
  }
})
