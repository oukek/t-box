const labels = { done: '已完成', running: '执行中', confirm: '待确认', pending: '待执行', failed: '失败', blocked: '等待依赖', paused: '已中断' }
const symbols = { done: '✓', running: '●', confirm: '◇', failed: '!', pending: '○', blocked: '–', paused: 'Ⅱ' }
const gitLabels = { success: '成功', skipped: '跳过', failure: '失败', in_progress: '执行中', completed: '结束', queued: '排队中', waiting: '等待中', cancelled: '已取消', timed_out: '超时', pending: '待执行' }
function el(tag, cls, text) {
  const item = document.createElement(tag)
  if (cls) {
    item.className = cls
  }
  if (text) {
    item.textContent = text
  }
  return item
}
let observer
export function drawGraph(flow, nodes, select) {
  observer?.disconnect()
  const levels = new Map()
  const columns = []
  const cards = new Map()
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  flow.append(svg)
  for (const n of nodes) {
    const level = Math.max(-1, ...n.deps.map((id) => levels.get(id))) + 1
    levels.set(n.id, level)
    if (!columns[level]) {
      const col = el('section', 'graph-col')
      columns[level] = col
      flow.append(col)
    }
    const btn = el('button', 'graph-node')
    btn.type = 'button'
    btn.dataset.status = n.status
    btn.id = 'node-' + n.id
    const activeStep = n.jobs?.flatMap((j) => j.steps).find((s) => s.status === 'in_progress')
    btn.append(el('span', 'node-name', n.label.replace(/^构建 /, '')), el('small', 'node-status', symbols[n.status] + '  ' + (n.status === 'running' && activeStep ? activeStep.name : labels[n.status])))
    btn.onclick = () => select(n)
    cards.set(n.id, btn)
    columns[level].append(btn)
  }
  for (const col of columns) {
    const lanes = [...new Set(nodes.filter((n) => cards.get(n.id).parentNode === col).map((n) => n.lane))]
    col.prepend(el('h3', 'column-title', lanes.join(' / ')))
  }
  const edges = () => {
    const box = flow.getBoundingClientRect()
    const mobile = matchMedia('(max-width:700px)').matches
    svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height)
    const paths = []
    for (const n of nodes) {
      const to = cards.get(n.id).getBoundingClientRect()
      for (const id of n.deps) {
        const from = cards.get(id).getBoundingClientRect()
        const x = mobile ? from.x + from.width / 2 - box.x : from.right - box.x
        const y = mobile ? from.bottom - box.y : from.y + from.height / 2 - box.y
        const endX = mobile ? to.x + to.width / 2 - box.x : to.x - box.x
        const endY = mobile ? to.top - box.y : to.y + to.height / 2 - box.y
        const path = document.createElementNS(svg.namespaceURI, 'path')
        const turn = mobile ? 'V ' + (y + endY) / 2 + ' H ' + endX : 'H ' + (levels.get(n.id) - levels.get(id) > 1 ? endX - 12 : (x + endX) / 2) + ' V ' + endY
        path.setAttribute('d', 'M ' + x + ' ' + y + ' ' + turn + ' L ' + endX + ' ' + endY)
        path.setAttribute('class', cards.get(id).dataset.status === 'done' ? 'passed' : '')
        paths.push(path)
      }
    }
    svg.replaceChildren(...paths)
  }
  observer = new ResizeObserver(edges)
  observer.observe(flow)
  edges()
}

export function inspectNode(n, nodes) {
  document.getElementById('inspect-title').textContent = n.label
  const body = document.getElementById('inspect-body')
  body.replaceChildren(el('p', 'inspection-status', labels[n.status] + (n.attempt ? ' · 第 ' + n.attempt + ' 次运行' : '')))
  if (n.deps.length) {
    body.append(el('p', 'prereqs', '依赖：' + n.deps.map((id) => nodes.find((v) => v.id === id).label).join('、')))
  }
  if (n.reusedFrom) {
    body.append(el('p', '', '复用提交 ' + n.reusedFrom.slice(0, 8) + ' 的已核验构建'))
  }
  if (n.syncError) {
    body.append(el('p', '', n.syncError))
  }
  for (const f of n.failures || []) {
    body.append(el('p', 'failure-note', new Date(f.at).toLocaleString() + ' · ' + f.reason))
  }
  if (n.link) {
    const a = el('a', '', '在 GitHub 查看运行日志 ↗')
    a.href = n.link
    a.target = '_blank'
    a.rel = 'noreferrer'
    body.append(a)
  }
  for (const job of n.jobs || []) {
    body.append(el('h3', '', job.name + ' · ' + (gitLabels[job.conclusion || job.status] || job.status)))
    for (const step of job.steps) {
      const status = step.conclusion || step.status
      const row = el('div', 'job-step ' + status)
      const start = Date.parse(step.startedAt)
      const end = status === 'in_progress' ? Date.now() : Date.parse(step.completedAt)
      const secs = start > 0 && end >= start ? Math.floor((end - start) / 1000) : null
      row.append(el('span', '', step.name), el('small', '', (gitLabels[status] || status) + (secs === null ? '' : ' · ' + secs + 's')))
      body.append(row)
    }
  }
  if (!n.jobs?.length && n.id.startsWith('build-')) {
    body.append(el('p', 'prereqs', 'GitHub 返回任务后在这里展示各步骤。'))
  }
}
