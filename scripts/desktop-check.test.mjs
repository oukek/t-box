import assert from 'node:assert/strict'
import { test } from 'node:test'
import { desktopChecks } from '../app/src/core/web-release/desktopCheck.ts'

test('startup, focus and manual checks share one result, and foreground checks throttle', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100 })
  let calls = 0
  let resolve
  let manual
  const gate = desktopChecks((isManual) => {
    calls++
    manual = isManual
    return new Promise((done) => {
      resolve = done
    })
  }, () => true)
  try {
    const task = gate.check('startup')
    await Promise.resolve()
    assert.equal(gate.check('foreground'), task)
    assert.equal(gate.check('manual'), task)
    assert.equal(manual(), true)
    resolve(true)
    await task
    gate.check('foreground')
    assert.equal(calls, 1)
    t.mock.timers.tick(60001)
    const second = gate.check('foreground')
    await Promise.resolve()
    assert.equal(calls, 2)
    resolve(true)
    await second
  } finally {
    gate.dispose()
  }
})

test('periodic checks, offline resume and exponential retry use one timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1 })
  let calls = 0
  let online = true
  const gate = desktopChecks(async () => {
    calls++
    return calls === 1 || calls > 3
  }, () => online)
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  try {
    await gate.check('startup')
    t.mock.timers.tick(30 * 60000)
    await settle()
    assert.equal(calls, 2)
    t.mock.timers.tick(59999)
    gate.check('online')
    assert.equal(calls, 2)
    t.mock.timers.tick(1)
    await settle()
    assert.equal(calls, 3)
    online = false
    t.mock.timers.tick(120000)
    await settle()
    assert.equal(calls, 3)
    online = true
    await gate.check('online')
    assert.equal(calls, 4)
    gate.dispose()
    t.mock.timers.tick(3600000)
    await settle()
    assert.equal(calls, 4)
  } finally {
    gate.dispose()
  }
})
