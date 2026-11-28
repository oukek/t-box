import { existsSync } from 'node:fs'
import { nodeDone, releaseGraph } from '../local-release-graph.mjs'
import { completedPlan, loadPlan, planKey, releaseState, root, statePath, statePlanKey } from '../local-release-plan.mjs'

process.once('message', async ({ pinned }) => {
  try {
    let latest
    let changed = false
    let changeError
    try {
      const loaded = await loadPlan()
      latest = { ...loaded, key: planKey(loaded.plan) }
      changed = !!pinned && pinned.key !== latest.key
    } catch (error) {
      if (!pinned) {
        throw error
      }
      changed = true
      changeError = error.message
    }
    const view = pinned || latest
    const { plan, steps, targets, key } = view
    const state = releaseState()
    const batch = state && statePlanKey(state) === key ? state : null
    const receipt = completedPlan(state, key)
    const graph = releaseGraph({ plan, steps, targets }).map((n) => ({ ...n, done: nodeDone(n, batch) }))
    process.send({ value: { view, state, batch, receipt, graph, changed, changeError, root, locked: existsSync(statePath + '.lock') } })
  } catch (error) {
    process.send({ error: error.message })
  }
})
