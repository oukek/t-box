import { drawGraph, inspectNode } from './graph.js'

const byId = (id) => document.getElementById(id)
byId('hide-inspect').onclick = () => byId('inspect').close()
let state
let decision
let selected
let previousFlow
let seenPrompt
let sending = false
function dialog(title, summary, action) {
  decision = action
  byId('dialog-title').textContent = title
  byId('summary').textContent = summary
  if (!byId('dialog').open) {
    byId('dialog').showModal()
  }
}
function confirmPrompt() {
  const p = state.prompt
  dialog(p.message, p.details || state.plan.notes, { path: '/answer', data: { id: p.id }, key: state.key })
}
function render(s) {
  state = s
  const done = s.nodes.filter((n) => n.status === 'done').length
  const live = s.nodes.find((n) => ['failed', 'running', 'confirm'].includes(n.status))
  byId('branch').textContent = [s.plan.branch, s.plan.ui && 'UI ' + s.plan.ui, s.sha?.slice(0, 7)].filter(Boolean).join('  /  ')
  byId('notes').textContent = s.plan.notes
  byId('meter').max = s.nodes.length
  byId('meter').value = done
  byId('progress').textContent = done + ' / ' + s.nodes.length + ' 个节点已完成'
  byId('state').textContent = s.complete ? '计划已完成' : s.blocked ? '计划已变更' : s.prompt ? '等待你的确认' : s.busy ? '正在执行' : s.failed ? '执行已停止' : s.resume ? '等待继续' : '等待开始'
  byId('detail').textContent = s.complete ? '请重新编写 release-plan.json，准备下一次发布。' : s.blocked ? '请恢复正在执行的计划，再继续这一批。' : live?.label || ''
  byId('tip').textContent = s.completedAt ? '完成于 ' + new Date(s.completedAt).toLocaleString('zh-CN') : ''
  byId('error').hidden = !s.failed
  byId('error').textContent = s.failed || ''
  byId('start').hidden = s.complete || s.blocked || s.busy
  byId('start').textContent = s.revise ? '核对修订计划…' : s.resume ? '继续本次发布' : '开始发布…'
  byId('revise').hidden = byId('start').hidden || !s.resume || !s.nodes.some((n) => n.status === 'failed')
  byId('review').hidden = !s.prompt || s.blocked
  byId('retry').hidden = byId('start').hidden || !s.resume || !s.nodes.some((n) => n.status === 'failed')
  byId('locate').hidden = !live
  const signature = JSON.stringify(s.nodes)
  if (signature !== previousFlow) {
    previousFlow = signature
    const flow = byId('flow')
    flow.replaceChildren()
    drawGraph(flow, s.nodes, (n) => {
      selected = n.id
      inspectNode(n, s.nodes)
      byId('inspect').showModal()
    })
    if (selected && byId('inspect').open) {
      const n = s.nodes.find((v) => v.id === selected)
      if (n) {
        inspectNode(n, s.nodes)
      } else {
        byId('inspect').close()
      }
    }
  }
  if (decision && (decision.key !== s.key || s.complete || s.blocked || (decision.data.id && decision.data.id !== s.prompt?.id))) {
    byId('dialog').close()
  }
  if (s.prompt && seenPrompt !== s.prompt.id && !s.blocked) {
    seenPrompt = s.prompt.id
    confirmPrompt()
  }
}
function showError(err) {
  byId('error').hidden = false
  byId('error').textContent = err.message
}
async function refresh() {
  const r = await fetch('/status')
  const s = await r.json()
  if (!r.ok) {
    throw new Error(s.error)
  }
  render(s)
}
function start(retry, revise = false) {
  dialog((revise || state.revise) ? '使用当前工作区修订本批次？' : state.resume ? '继续执行本次计划？' : '开始本次发布？', [state.plan.notes, ...state.nodes.filter((n) => n.status !== 'done').map((n) => '→ ' + n.label)].join('\n'), { path: '/start', data: { retry, revise }, key: state.key })
}
byId('start').onclick = () => start(false)
byId('retry').onclick = () => start(true)
byId('revise').onclick = () => start(false, true)
byId('review').onclick = confirmPrompt
byId('locate').onclick = () => document.querySelector('.graph-node:is([data-status="running"],[data-status="confirm"],[data-status="failed"])')?.scrollIntoView({ block: 'center' })
byId('cancel').onclick = () => byId('dialog').close()
byId('dialog').onclose = () => {
  decision = null
}
byId('ok').onclick = async () => {
  if (!decision || sending) {
    return
  }
  const { path, data, key } = decision
  sending = true
  byId('ok').disabled = true
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Release-Token': state.token }, body: JSON.stringify({ ...data, key, accept: true }) })
    if (!r.ok) {
      throw new Error((await r.json()).error)
    }
  } catch (error) {
    showError(error)
  } finally {
    byId('dialog').close()
    sending = false
    byId('ok').disabled = false
  }
}
async function poll() {
  try {
    await refresh()
  } catch (error) {
    byId('start').hidden = true
    byId('review').hidden = true
    byId('retry').hidden = true
    byId('state').textContent = '无法读取计划'
    showError(error)
  } finally {
    setTimeout(poll, 1200)
  }
}
void poll()
