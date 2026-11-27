import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { nodeDone, releaseGraph } from '../local-release-graph.mjs'
import { completedPlan, loadPlan, planKey, releaseState, root, statePath, statePlanKey } from '../local-release-plan.mjs'

const token = randomUUID()
let worker
let activeKey
let activeNode
let failure
let prompt
let origin

async function snapshot() {
  const { plan, steps, targets } = await loadPlan()
  const key = planKey(plan)
  const state = releaseState()
  const matches = state && statePlanKey(state) === key
  const batch = matches ? state : null
  const busy = !!worker || existsSync(statePath + '.lock')
  const revise = !!state && !state.complete && !matches
  const blocked = (revise && busy && !worker) || (worker && activeKey !== key)
  const receipt = completedPlan(state, key)
  const complete = !!receipt
  const nodes = releaseGraph({ plan, steps, targets }).map((n) => {
    const progress = batch?.progress?.[n.id]
    const run = n.step && batch?.runs[n.step.key]
    let status = 'pending'
    if (complete || nodeDone(n, batch)) {
      status = 'done'
    } else if (prompt && activeNode === n.id) {
      status = 'confirm'
    } else if (progress?.status === 'failed') {
      status = 'failed'
    } else if (busy && (progress?.status === 'running' || (worker && activeNode === n.id))) {
      status = 'running'
    } else if (!busy && progress?.status === 'running') {
      status = 'paused'
    } else if (activeKey === key && failure && activeNode === n.id && !batch?.progress) {
      status = 'failed'
    }
    return { id: n.id, label: n.label, lane: n.lane, deps: n.deps, status, reason: progress?.error, failures: progress?.failures, jobs: run?.jobs, attempt: run?.attempt, actionStatus: run?.status, updated: run?.updatedAt, syncError: run?.syncError, reusedFrom: run?.reusedFrom, link: run?.id && 'https://github.com/' + batch.repo + '/actions/runs/' + run.id }
  })
  for (const n of nodes) {
    if (n.status === 'pending' && n.deps.some((id) => ['failed', 'blocked'].includes(nodes.find((v) => v.id === id)?.status))) {
      n.status = 'blocked'
    }
  }
  const failed = (activeKey === key && failure) || nodes.filter((n) => n.status === 'failed').map((n) => n.reason).filter(Boolean).join('\n')
  return { key, token, plan, nodes, complete, completedAt: receipt?.at, busy, blocked: !!blocked, revise, resume: !!batch && !complete, failed, prompt, sha: receipt?.sha || batch?.sha }
}

function start(key, resume, retry, revise) {
  activeKey = key
  activeNode = 'prepare'
  failure = null
  prompt = null
  worker = fork(new URL('../local-release.mjs', import.meta.url), [...(revise ? ['--revise'] : []), ...(resume ? ['--resume'] : []), ...(retry ? ['--retry'] : [])], {
    cwd: root,
    execArgv: ['--env-file-if-exists=.env.release.local'],
    env: { ...process.env, TBOX_EXPECT_PLAN: key },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  worker.on('message', (msg) => {
    if (msg.type === 'node') {
      activeNode = msg.node
    }
    if (msg.type === 'confirm') {
      prompt = { id: msg.id, message: msg.message, details: msg.details }
    }
    if (msg.type === 'failure') {
      failure = msg.message
    }
  })
  worker.on('error', (error) => {
    failure = error.message
  })
  worker.on('close', (code) => {
    if (code !== 0 && !failure) {
      failure = '执行已中断，请核对进度后继续。'
    }
    worker = null
    prompt = null
  })
}

const assets = { '/': ['index.html', 'text/html'], '/page.css': ['page.css', 'text/css'], '/page.js': ['page.js', 'text/javascript'], '/graph.js': ['graph.js', 'text/javascript'] }
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', 'default-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'none\'')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  try {
    if ('http://' + req.headers.host !== origin || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end()
      return
    }
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      res.writeHead(204).end()
      return
    }
    if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
      const [path, type] = assets[req.url]
      res.setHeader('Content-Type', type + '; charset=utf-8')
      res.end(readFileSync(new URL(path, import.meta.url)))
      return
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.method === 'GET' && req.url === '/status') {
      res.end(JSON.stringify(await snapshot()))
      return
    }
    if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-release-token'] !== token) {
      res.writeHead(403).end()
      return
    }
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 2048) {
        throw new Error('请求过长')
      }
    }
    const input = JSON.parse(body)
    const state = await snapshot()
    if (input.key !== state.key || state.blocked || state.complete) {
      throw new Error('计划已执行或已变化，请刷新页面')
    }
    if (req.url === '/start' && !state.busy && !worker) {
      start(state.key, state.resume && input.revise !== true, state.resume && input.retry === true, state.revise || (state.resume && input.revise === true))
    } else if (req.url === '/answer' && worker && prompt && prompt.id === input.id) {
      const id = prompt.id
      prompt = null
      worker.send({ id, accept: input.accept === true })
    } else {
      throw new Error('当前步骤已改变，请刷新进度')
    }
    res.end('{}')
  } catch (error) {
    res.writeHead(409).end(JSON.stringify({ error: error.message }))
  }
})
server.on('error', (err) => {
  console.error(err.message)
  process.exitCode = 1
})
server.listen(Number(process.env.TBOX_RELEASE_PORT || 4186), '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port
  console.info('方舟发布工作台：' + origin)
})
