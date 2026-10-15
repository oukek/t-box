import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shellVersionCompatible } from '../src/core/app-runtime/compatibility'
import { advanceLaunchProgress, createLaunchState } from '../src/core/app-runtime/launchState'

test('a bundled system application explicitly supports existing installed versions', () => {
  assert.equal(shellVersionCompatible('1.0.0', '1.0.2', '1.0.0'), true)
  assert.equal(shellVersionCompatible('1.0.1', '1.0.2', '1.0.0'), true)
  assert.equal(shellVersionCompatible('1.0.2', '1.0.2'), true)
  assert.equal(shellVersionCompatible('1.2.9', '1.10.0', '1.0.0'), true)
})
test('undeclared, future, breaking and invalid versions still require compatible host code', () => {
  assert.equal(shellVersionCompatible('1.0.0', '1.0.2'), false)
  assert.equal(shellVersionCompatible('1.0.3', '1.0.2', '1.0.0'), false)
  assert.equal(shellVersionCompatible('1.0.2', '2.0.0', '2.0.0'), false)
  assert.equal(shellVersionCompatible('broken', '1.0.2', '1.0.0'), false)
  assert.equal(shellVersionCompatible('1.0.0', 'broken', '1.0.0'), false)
  assert.equal(shellVersionCompatible('1.0.0', '1.0.2', 'broken'), false)
})
test('shell component readiness and the Web SDK handshake share one launch state', () => {
  const shell = createLaunchState()
  shell.pending()
  shell.resolved()
  assert.equal(shell.stage.value, 'ready')
  shell.pending()
  shell.update('failed')
  shell.resolved()
  assert.equal(shell.stage.value, 'failed', 'an async import failure cannot be overwritten by Suspense resolution')
  const web = createLaunchState()
  web.registerWebRuntime()
  web.pending()
  web.update('resources')
  web.resolved()
  assert.equal(web.stage.value, 'resources', 'loading the host component alone does not finish iframe startup')
  web.update('connecting')
  web.update('failed')
  assert.equal(web.stage.value, 'failed')
  web.pending()
  web.update('ready')
  assert.equal(web.stage.value, 'ready')
})
test('estimated progress never completes on time alone or moves backward between phases', () => {
  let progress = 0.08
  for (const stage of ['resolving', 'resources', 'connecting'] as const) {
    for (let i = 0; i < 1000; i++) {
      const next = advanceLaunchProgress(progress, stage)
      assert.ok(next >= progress && next < 1)
      progress = next
    }
  }
  assert.equal(progress, 0.92)
  assert.equal(advanceLaunchProgress(progress, 'resolving'), progress)
  assert.equal(advanceLaunchProgress(progress, 'failed'), progress)
  assert.equal(advanceLaunchProgress(progress, 'ready'), 1)
})
