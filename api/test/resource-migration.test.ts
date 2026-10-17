import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('the migration entry point works through a current-release symlink and validates OSS before connecting', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-migration-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const alias = join(root, 'current-migration.ts')
  await symlink(fileURLToPath(new URL('../src/resources/migrate-local.ts', import.meta.url)), alias)
  const require = createRequire(import.meta.url)
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), alias], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', APP_ARTIFACT_DELIVERY: 'oss', OSS_REGION: '', OSS_ACCESS_KEY_ID: '', OSS_ACCESS_KEY_SECRET: '', OSS_SESSION_TOKEN: '', MYSQL_HOST: '127.0.0.1:1' },
    timeout: 10000,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /业务文件 OSS 配置不完整/)
})
