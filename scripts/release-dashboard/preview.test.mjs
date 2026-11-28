import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { readPreview } from './read-preview.mjs'

test('idle previews refresh plans and transitive code; running previews stay pinned', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-preview-'))
  try {
    await mkdir(join(dir, 'dashboard'))
    await writeFile(join(dir, 'dashboard/preview.mjs'), await readFile(new URL('./preview.mjs', import.meta.url)))
    await writeFile(join(dir, 'local-release-graph.mjs'), await readFile(new URL('../local-release-graph.mjs', import.meta.url)))
    await writeFile(join(dir, 'hash.mjs'), 'export const salt="old"')
    await writeFile(join(dir, 'local-release-plan.mjs'), `
      import {readFileSync} from 'node:fs';
      import {salt} from './hash.mjs';
      export const root=${JSON.stringify(dir)},statePath=root+'/state.json';
      export const planKey=p=>salt+JSON.stringify(p);
      export const statePlanKey=s=>s.planKey;
      export const releaseState=()=>JSON.parse(readFileSync(statePath));
      export const completedPlan=(s,key)=>s.complete&&s.planKey===key?{sha:'fixture',at:'now'}:null;
      export async function loadPlan(){const plan=JSON.parse(readFileSync(root+'/plan.json'));return {plan,steps:[{key:'ui',kind:'ui',label:plan.ui}],targets:[]}}
    `)
    const entry = pathToFileURL(join(dir, 'dashboard/preview.mjs'))
    const plan = { ui: '1.0.0' }
    await writeFile(join(dir, 'plan.json'), JSON.stringify(plan))
    await writeFile(join(dir, 'state.json'), JSON.stringify({ complete: true, planKey: 'old' + JSON.stringify(plan), runs: {}, targets: [] }))
    const first = await readPreview(undefined, entry)
    assert.ok(first.receipt)
    await writeFile(join(dir, 'plan.json'), JSON.stringify({ ui: '1.0.1' }))
    const next = await readPreview(undefined, entry)
    assert.equal(next.view.plan.ui, '1.0.1')
    assert.equal(next.receipt, null)
    assert.notEqual(next.view.key, first.view.key)
    // Editing a dependency of the reader must invalidate Node's module cache too.
    await writeFile(join(dir, 'hash.mjs'), 'export const salt="new"')
    const updated = await readPreview(undefined, entry)
    assert.match(updated.view.key, /^new/)
    const active = await readPreview(next.view, entry)
    assert.equal(active.changed, true)
    assert.deepEqual(active.view, next.view)
    await writeFile(join(dir, 'plan.json'), '{')
    await assert.rejects(readPreview(undefined, entry))
    const invalidDuringRun = await readPreview(next.view, entry)
    assert.equal(invalidDuringRun.changed, true)
    assert.deepEqual(invalidDuringRun.view, next.view)
    // The release history is preserved; reading never mutates progress.
    assert.equal(JSON.parse(await readFile(join(dir, 'state.json'))).complete, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
