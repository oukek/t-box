import assert from 'node:assert/strict'
import test from 'node:test'
import { httpsUrl, publishApp, systemTarget, targetEntry } from './local-release-admin.mjs'
import { readReceipt, waitForWorkflow } from './local-release-github.mjs'

const sha = 'a'.repeat(40)
const record = () => ({ key: sha + '-batch-todo' })
const step = { workflow: 'application-release.yml', kind: 'app', inputs: { application: '待办事项 (todo)' }, label: '待办', id: 'todo', version: '1.1.5' }
const options = { step, sha, repo: 'owner/ark', branch: 'main', save() {}, sleep: async () => {} }

test('dispatch once, wait for running and success, then reuse the exact run after restart', async () => {
  const state = record()
  let dispatches = 0
  let polls = 0
  const gh = ([command, sub]) => {
    if (command === 'api') {
      return sha
    }
    if (command === 'workflow') {
      dispatches++
      return
    }
    const run = { headSha: sha, displayTitle: state.key, databaseId: 165 }
    if (sub === 'list') {
      return JSON.stringify([{ ...run, displayTitle: 'another', databaseId: 166 }, run])
    }
    return JSON.stringify({ ...run, attempt: 1, status: ++polls > 1 ? 'completed' : 'in_progress', conclusion: 'success' })
  }
  await waitForWorkflow({ ...options, record: state, gh })
  await waitForWorkflow({ ...options, record: state, gh })
  assert.equal(state.id, 165)
  assert.equal(dispatches, 1)
  assert.equal(polls, 3)
})
test('stop on a failed run or wrong SHA before proceeding', async () => {
  const state = { ...record(), dispatched: true, id: 165 }
  const run = { displayTitle: state.key, status: 'completed', conclusion: 'failure', attempt: 1 }
  for (const headSha of [sha, 'wrong']) {
    await assert.rejects(waitForWorkflow({ ...options, record: state, gh: () => JSON.stringify({ ...run, headSha }) }), /failure|不匹配/)
  }
})
test('release receipts must belong to the selected app, version and a unique candidate', () => {
  const line = 'job\tstep\t2026-11-27T00:00:00Z Build registered: todo 1.1.5, release todo-abc, status submitted. Publication requires an administrator.'
  assert.equal(readReceipt(line, step), 'todo-abc')
  assert.throws(() => readReceipt(line.replace('1.1.5', '1.1.4'), step))
  assert.throws(() => readReceipt(line + '\n' + line.replace('todo-abc', 'todo-other'), step))
})
const target = { id: 'todo', version: '1.1.5', receipt: 'new', expected: 'old', runtime: 'web' }
function listing() {
  const entry = { release: { releaseId: 'new', manifest: { version: '1.1.5' }, runtime: { type: 'web' } }, status: 'submitted', revision: 2, readiness: { pendingVerification: true } }
  return { applications: [{ appId: 'todo', currentReleaseId: 'old', releases: [entry] }] }
}
test('lost publish response: resume verifies live release without repeating writes', async () => {
  const list = listing()
  const app = list.applications[0]
  const entry = app.releases[0]
  const writes = []
  const request = async (path, method, body) => {
    if (!method) {
      return list
    }
    writes.push(method)
    if (method === 'PATCH') {
      entry.releaseNotes = body.releaseNotes
      entry.revision++
    } else {
      assert.equal(body.expectedCurrentReleaseId, 'old')
      assert.equal(body.revision, 3)
      entry.status = 'published'
      app.currentReleaseId = 'new'
      throw new Error('timeout')
    }
  }
  await assert.rejects(publishApp(request, target, '说明'), /timeout/)
  await publishApp(request, target, '说明')
  assert.deepEqual(writes, ['PATCH', 'POST'])
})
test('reject unexpected online versions, unrelated UI builds and core bundles', () => {
  const apps = listing()
  apps.applications[0].currentReleaseId = 'other'
  assert.throws(() => targetEntry(apps, target))
  const ui = { receipt: 'build', version: '1.3.6', expected: 'baseline' }
  const row = { build: 'build', version: '1.3.6', state: 'pending', shared: true }
  const list = { current: { build: 'baseline' }, candidates: [row] }
  assert.equal(systemTarget(list, ui), row)
  assert.throws(() => systemTarget(list, { ...ui, receipt: 'different-build' }))
  assert.throws(() => systemTarget({ ...list, candidates: [{ ...row, coreVersion: '1.0.6' }] }, ui))
})

test('completed plans remain recognizable after reopening or starting another batch', async () => {
  const { completedPlan, planKey } = await import('./local-release-plan.mjs')
  const plan = { branch: 'main', notes: '发布', deployApi: false, ui: null, applications: { todo: '1.1.5' } }
  const key = planKey(plan)
  const finished = { complete: true, planKey: key, sha, completedAt: '2026-11-27T01:00:00Z' }
  const receipt = completedPlan(JSON.parse(JSON.stringify(finished)), key)
  assert.deepEqual(receipt, { sha, at: finished.completedAt })
  assert.equal(completedPlan({ ...finished, complete: false }, key), undefined)
  const next = planKey({ ...plan, applications: { todo: '1.1.6' } })
  assert.equal(completedPlan(finished, next), undefined)
  assert.deepEqual(completedPlan({ planKey: next, completedPlans: { [key]: receipt } }, key), receipt)
})

test('release URL errors name the missing or malformed setting without echoing its value', () => {
  assert.throws(() => httpsUrl(undefined, 'TBOX_RELEASE_API'), /缺少 TBOX_RELEASE_API.*\.env\.release\.local/)
  assert.throws(() => httpsUrl('invalid-value', 'TBOX_RELEASE_WEB'), /TBOX_RELEASE_WEB 格式错误/)
  assert.equal(httpsUrl('https://example.com/api/v1/', 'TBOX_RELEASE_API'), 'https://example.com/api/v1')
})

test('parallel build graph caps app jobs, waits at joins and retries only failed or unstarted work', async () => {
  const { executeGraph, releaseGraph } = await import('./local-release-graph.mjs')
  const apps = Array.from({ length: 6 }, (_, i) => ({ key: 'a' + i, id: 'a' + i, kind: 'app', inputs: { application: 'App' } }))
  const graph = releaseGraph({ plan: { ui: '1.0.1' }, steps: [...apps, { key: 'api', kind: 'api' }, { key: 'ui', kind: 'ui' }], targets: [] })
  const done = new Set(['prepare'])
  const attempts = []
  let peak = 0
  let active = 0
  let fail = true
  const work = async (n) => {
    assert.ok(n.deps.every((id) => done.has(id)))
    attempts.push(n.id)
    if (n.pool === 'app') {
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    }
    if (fail && n.id === 'build-a1') {
      throw new Error('fixture failure')
    }
    done.add(n.id)
  }
  await assert.rejects(executeGraph(graph, done, work, () => {}), /fixture failure/)
  assert.equal(peak, 3)
  assert.ok(done.has('build-ui') && done.has('build-a5') && !done.has('build-api') && !done.has('approve'))
  fail = false
  attempts.length = 0
  await executeGraph(graph, done, work, () => {})
  assert.deepEqual(attempts, ['build-a1', 'build-api', 'approve', 'publish-ui'])
})
test('uses the producing reusable workflow job for the UI receipt', async () => {
  const { workflowReceipt } = await import('./local-release-github.mjs')
  const build = '00000000-0000-4000-8000-000000000001'
  const receipt = await workflowReceipt('owner/repo', { id: 1, jobs: [{ id: 42, steps: [{ name: '获取线上基线并预留版本', conclusion: 'success' }] }] }, { kind: 'ui' }, async (args) => {
    assert.deepEqual(args, ['api', 'repos/owner/repo/actions/jobs/42/logs'])
    return 'Reserved system build: ' + build
  })
  assert.equal(receipt, build)
})

test('a reused deployment cannot open the approval gate before a changed dependency finishes', async () => {
  const { executeGraph } = await import('./local-release-graph.mjs')
  const nodes = [{ id: 'changed', deps: [] }, { id: 'reused', deps: ['changed'] }, { id: 'approve', deps: ['reused'] }]
  const order = []
  await executeGraph(nodes, ['reused'], async (n) => {
    if (n.id === 'changed') {
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
    order.push(n.id)
  }, () => {})
  assert.deepEqual(order, ['changed', 'approve'])
})

test('joint release verifies exact core version and cannot reuse a UI-only candidate', async () => {
  const { planKey, loadPlan } = await import('./local-release-plan.mjs')
  const base = { branch: 'main', ui: '1.3.8', deployApi: false, notes: '联合发布', applications: {} }
  assert.notEqual(planKey(base), planKey({ ...base, macosCore: '1.0.6' }))
  const target = { version: '1.3.8', coreVersion: '1.0.6', receipt: 'joint', expected: null }
  const row = { build: 'joint', version: '1.3.8', coreVersion: '1.0.6', shared: true, state: 'pending' }
  assert.equal(systemTarget({ current: null, candidates: [row] }, target), row)
  for (const coreVersion of [null, '1.0.5', '1.0.7']) {
    assert.throws(() => systemTarget({ current: null, candidates: [{ ...row, coreVersion }] }, target))
  }
  const { plan, steps } = await loadPlan()
  if (plan.macosCore) {
    assert.equal(steps.filter((s) => s.kind === 'ui').length, 1)
    assert.equal(steps.find((s) => s.kind === 'ui').workflow, 'desktop-release.yml')
  }
})
