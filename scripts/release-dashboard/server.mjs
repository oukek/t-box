import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
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
  const blocked = (state && !state.complete && !matches) || (worker && activeKey !== key)
  const receipt = completedPlan(state, key)
  const complete = !!receipt
  const failed = activeKey === key && failure
  const nodes = []
  function node(id, group, label, done, link) {
    nodes.push({ id, group, label, link, status: complete ? 'done' : (failed && id === activeNode) ? 'failed' : (worker && activeNode === id) ? (prompt ? 'confirm' : 'running') : done ? 'done' : 'pending' })
  }
  node('prepare', '准备', '检查配置并提交到 ' + plan.branch, batch?.pushed)
  for (const step of steps) {
    const run = batch?.runs[step.key]
    node('build-' + step.key, '构建与部署', step.label, run?.done, run?.id && 'https://github.com/' + batch.repo + '/actions/runs/' + run.id)
  }
  node('approve', '上线', '核对候选并确认上线', batch?.approved)
  if (plan.ui) {
    node('publish-ui', '上线', '发布主界面 ' + plan.ui, batch?.ui?.verified)
  }
  for (const t of targets) {
    const name = steps.find((s) => s.id === t.id)?.inputs.application.split(' (')[0] || ({ market: '应用市场', profile: '设置' })[t.id] || t.id
    node('publish-' + t.id, '上线', '发布' + name + ' ' + t.version, batch?.targets.find((v) => v.id === t.id)?.verified)
  }
  // A separate CLI or a reopened dashboard can follow persisted checkpoints too.
  if (!worker && busy && !complete && matches) {
    const next = nodes.find((n) => n.status === 'pending')
    if (next) {
      next.status = 'running'
    }
  }
  return { key, token, plan, nodes, complete, completedAt: receipt?.at, busy, blocked: !!blocked, resume: !!batch && !complete, failed, prompt, sha: receipt?.sha || batch?.sha }
}

function start(key, resume, retry) {
  activeKey = key
  activeNode = 'prepare'
  failure = null
  prompt = null
  worker = fork(new URL('../local-release.mjs', import.meta.url), [...(resume ? ['--resume'] : []), ...(retry ? ['--retry'] : [])], {
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

const assets = { '/': ['index.html', 'text/html'], '/page.css': ['page.css', 'text/css'], '/page.js': ['page.js', 'text/javascript'] }
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
      start(state.key, state.resume, state.resume && input.retry === true)
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
