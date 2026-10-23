import type { ApplicationContext, DeviceCapability } from '@t-box/app-contracts'
import type { deviceAdapter } from '../src/core/native-runtime/host.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APP_SDK_VERSION } from '@t-box/app-contracts'
import { selectShortcutAction } from '../src/core/native-runtime/action-selection.js'
import { deviceConsent, requestDeviceConsent } from '../src/core/native-runtime/consent.js'
import { handleDeviceCall } from '../src/core/native-runtime/host.js'
import { parseCalendarDraft, parseDeviceInput } from '../src/core/native-runtime/validation.js'

const context: ApplicationContext = { sdkVersion: APP_SDK_VERSION, appId: 'calendar', releaseId: 'calendar-1', generation: 1, subject: 'local-fixture', platform: 'ios', runtime: 'web', params: {}, permissions: [], capabilities: [], access: 'local' }
const draft = { title: '聚会', startAt: '2026-11-01T10:00:00+08:00', endAt: '2026-11-01T12:00:00+08:00' }

test('device input validation rejects arbitrary URLs, unbounded ranges and unknown fields', () => {
  assert.deepEqual(parseDeviceInput('phone.dial', { number: '+86 (138) 0013-8000' }), { number: '+8613800138000' })
  for (const number of ['tel:13800138000', 'javascript:alert(1)', '*#06#', '13800138000?x=y', '1']) {
    assert.throws(() => parseDeviceInput('phone.dial', { number }), { code: 'INVALID_ARGUMENTS' })
  }
  assert.throws(() => parseDeviceInput('system.openSettings', { url: 'https://example.com' }), { code: 'INVALID_ARGUMENTS' })
  assert.deepEqual(parseCalendarDraft(draft), draft)
  assert.throws(() => parseCalendarDraft({ ...draft, startAt: '2026-11-01T10:00:00' }), { code: 'INVALID_ARGUMENTS' })
  assert.throws(() => parseCalendarDraft({ ...draft, timeZone: 'Not/AZone' }), { code: 'INVALID_ARGUMENTS' })
  assert.throws(() => parseCalendarDraft({ ...draft, url: 'tbox://anything' }), { code: 'INVALID_ARGUMENTS' })
  assert.throws(() => parseCalendarDraft({ ...draft, reminderMinutes: [-1] }), { code: 'INVALID_ARGUMENTS' })
  assert.throws(() => parseDeviceInput('calendar.list', { from: '2026-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z' }), { code: 'INVALID_ARGUMENTS' })
})

test('local device calls require declarations and scoped grants, never network or identity', async () => {
  const calls: { scope: string, capability: DeviceCapability, args: Record<string, unknown>, key: string }[] = []
  const adapter: typeof deviceAdapter = { platform: () => 'ios', supported: async () => ['calendar.presentCreate'], grants: async () => ['calendar.presentCreate'], changeGrant: async () => {}, invoke: async (scope, capability, args, key) => {
    calls.push({ scope, capability, args, key })
    return { status: 'saved', id: 'event-1' }
  } }
  const input = { method: 'device.invoke' as const, args: { capability: 'calendar.presentCreate', arguments: draft }, context, name: '日历', bundled: ['calendar.presentCreate'] as DeviceCapability[], requestId: 'stable-retry-1', signal: new AbortController().signal, assertCurrent() {}, adapter }
  assert.deepEqual(await handleDeviceCall(input), { status: 'saved', id: 'event-1' })
  assert.equal(calls[0]?.scope, 'guest:calendar')
  assert.equal(calls[0]?.key, 'stable-retry-1')
  await assert.rejects(handleDeviceCall({ ...input, bundled: [] }), { code: 'CAPABILITY_UNAVAILABLE' })
  await assert.rejects(handleDeviceCall({ ...input, args: { ...input.args, scope: 'other-account' } }), { code: 'INVALID_ARGUMENTS' })
  await assert.rejects(handleDeviceCall({ ...input, signal: AbortSignal.abort() }), { code: 'APP_CLOSED' })
  assert.equal(calls.length, 1)
})

test('identity changes while native permission state is awaited fence the actual effect', async () => {
  let current = true
  let invoked = false
  const adapter: typeof deviceAdapter = { platform: () => 'ios', supported: async () => ['phone.dial'], grants: async () => {
    current = false
    return ['phone.dial']
  }, changeGrant: async () => {}, invoke: async () => {
    invoked = true
  } }
  await assert.rejects(handleDeviceCall({ method: 'device.invoke', args: { capability: 'phone.dial', arguments: { number: '13800138000' } }, context, name: '应用', bundled: ['phone.dial'], owner: 'user-a', requestId: 'call-1', signal: new AbortController().signal, assertCurrent() {
    assert.equal(current, true)
  }, adapter }))
  assert.equal(invoked, false)
})

test('consent cancellation closes the pending prompt and concurrent prompts cannot overwrite it', async () => {
  const abort = new AbortController()
  const promise = requestDeviceConsent('日历', ['calendar.presentCreate'], abort.signal)
  assert.equal(deviceConsent.current?.appName, '日历')
  await assert.rejects(requestDeviceConsent('其他应用', ['phone.dial']), { code: 'DEVICE_BUSY' })
  abort.abort()
  assert.equal(await promise, false)
  assert.equal(deviceConsent.current, null)
})

test('unsupported browser capabilities request download guidance without consenting or invoking; browser-supported sharing stays local', async () => {
  const guidance: DeviceCapability[][] = []
  let invoked = 0
  const adapter: typeof deviceAdapter = { platform: () => 'web', supported: async () => ['share.present'], grants: async () => ['share.present'], changeGrant: async () => assert.fail('must not grant unsupported capability'), unavailable: (capabilities) => {
    guidance.push(capabilities)
  }, invoke: async () => {
    invoked++
    return { status: 'shared' }
  } }
  const input = { method: 'device.invoke' as const, context, name: '日历', bundled: ['calendar.presentCreate', 'share.present'] as DeviceCapability[], requestId: 'browser-1', signal: new AbortController().signal, assertCurrent() {}, adapter }
  await assert.rejects(handleDeviceCall({ ...input, args: { capability: 'calendar.presentCreate', arguments: draft } }), { code: 'DEVICE_UNSUPPORTED' })
  assert.deepEqual(guidance, [['calendar.presentCreate']])
  assert.equal(deviceConsent.current, null)
  assert.equal(invoked, 0)
  assert.deepEqual(await handleDeviceCall({ ...input, args: { capability: 'share.present', arguments: { text: '分享内容' } } }), { status: 'shared' })
  assert.equal(invoked, 1)
  assert.equal(guidance.length, 1)
  await assert.rejects(handleDeviceCall({ ...input, bundled: [], args: { capability: 'calendar.presentCreate', arguments: draft } }), { code: 'CAPABILITY_UNAVAILABLE' })
  assert.equal(guidance.length, 1)
})

test('bundled local UI configures matching action contracts; online runtimes also require exact generation', () => {
  const action = { id: 'convert', version: 1, appId: 'calendar', title: 'fixture', description: '', inputSchema: {}, effect: 'read' as const, background: true, releaseId: 'installed-2', generation: 3 }
  assert.equal(selectShortcutAction(context, 'convert', 1, [action]), action)
  assert.equal(selectShortcutAction(context, 'convert', 2, [action]), undefined)
  assert.equal(selectShortcutAction(context, 'convert', 1, [{ ...action, appId: 'other' }]), undefined)
  assert.equal(selectShortcutAction({ ...context, access: 'online' }, 'convert', 1, [action]), undefined)
  assert.equal(selectShortcutAction({ ...context, access: 'online', releaseId: action.releaseId, generation: action.generation }, 'convert', 1, [action]), action)
})
