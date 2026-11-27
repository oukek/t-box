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
