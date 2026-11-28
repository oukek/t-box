// The same dependency edges determine both execution order and the dashboard drawing.
export function releaseGraph({ plan, steps, targets }) {
  const nodes = [{ id: 'prepare', label: '提交并推送', lane: '准备', deps: [] }]
  const apps = steps.filter((s) => s.kind === 'app').map((s) => 'build-' + s.key)
  for (const step of steps) {
    let deps = ['prepare']
    if (step.kind === 'api' && apps.length) {
      deps = apps
    }
    if (step.kind === 'ui' && plan.uiAfterApi) {
      deps = ['build-api']
    }
    nodes.push({ id: 'build-' + step.key, label: step.label, lane: step.kind === 'api' ? '部署' : '构建', deps, step, pool: step.kind === 'app' ? 'app' : undefined })
  }
  const ends = nodes.filter((n) => n.step && !nodes.some((next) => next.deps.includes(n.id)))
  nodes.push({ id: 'approve', label: '核验候选 · 确认上线', lane: '确认', deps: ends.map((n) => n.id) })
  if (plan.ui) {
    nodes.push({ id: 'publish-ui', label: plan.macosCore ? `发布主界面 ${plan.ui} + Mac 核心 ${plan.macosCore}` : '发布主界面 ' + plan.ui, lane: '上线', deps: ['approve'] })
  }
  for (const t of targets) {
    const app = steps.find((s) => s.id === t.id)
    const name = app?.inputs.application.split(' (')[0] || ({ market: '应用市场', profile: '设置' })[t.id] || t.id
    nodes.push({ id: 'publish-' + t.id, label: name + ' ' + t.version, target: t.id, lane: '上架', deps: [plan.ui ? 'publish-ui' : 'approve'], pool: 'publish' })
  }
  return nodes
}

export async function executeGraph(nodes, completed, execute, checkpoint, outstanding = () => false) {
  const verified = new Set(completed)
  const done = new Set()
  const attempted = new Set()
  const active = new Map()
  const errors = []
  for (;;) {
    for (const node of nodes) {
      if (attempted.has(node.id) || !node.deps.every((id) => done.has(id))) {
        continue
      }
      if (verified.has(node.id)) {
        done.add(node.id)
        attempted.add(node.id)
        continue
      }
      if (node.pool) {
        const reserved = nodes.filter((n) => n.pool === node.pool && (active.has(n.id) || outstanding(n))).length
        if (!outstanding(node) && reserved >= 3) {
          continue
        }
      }
      attempted.add(node.id)
      const task = Promise.resolve().then(async () => {
        checkpoint(node, 'running')
        try {
          await execute(node)
          done.add(node.id)
          checkpoint(node, 'done')
        } catch (error) {
          errors.push(node.label + '：' + error.message)
          checkpoint(node, 'failed', error.message)
        }
      }).finally(() => active.delete(node.id))
      active.set(node.id, { pool: node.pool, task })
    }
    if (!active.size) {
      break
    }
    await Promise.race([...active.values()].map((a) => a.task))
  }
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
  if (nodes.some((n) => !done.has(n.id))) {
    throw new Error('依赖未完成，请检查发布计划')
  }
}

export function nodeDone(n, state) {
  if (n.id === 'prepare') {
    return !!state?.pushed
  }
  if (n.step) {
    return !!state?.runs[n.step.key]?.done
  }
  if (n.id === 'approve') {
    return !!state?.approved
  }
  if (n.id === 'publish-ui') {
    return !!state?.ui?.verified
  }
  return !!state?.targets.find((t) => t.id === n.target)?.verified
}
