import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { adminClient, httpsUrl, publishApp, publishUi, systemTarget, targetEntry } from './local-release-admin.mjs'
import { command, waitForWorkflow, workflowReceipt } from './local-release-github.mjs'
import { executeGraph, nodeDone, releaseGraph } from './local-release-graph.mjs'
import { appInputsChanged, completedPlan, loadPlan, planKey, releaseState, root, statePath, statePlanKey, versionPattern } from './local-release-plan.mjs'

process.chdir(root)
const args = process.argv.slice(2)
const resume = args.includes('--resume')
const git = (...args) => command('git', args)
const report = (event) => process.send?.(event)
let currentNode = 'prepare'
function enter(node) {
  currentNode = node
  report({ type: 'node', node })
}
function newer(target, current) {
  if (!versionPattern.test(current)) {
    throw new Error('无法比较线上版本 ' + current)
  }
  const before = current.split('.').map(BigInt)
  const after = target.split('.').map(BigInt)
  for (const [i, v] of after.entries()) {
    if (v !== before[i]) {
      return v > before[i]
    }
  }
  return false
}

let confirmationQueue = Promise.resolve()
function confirm(message, details = '') {
  const next = confirmationQueue.then(() => ask(message, details))
  confirmationQueue = next.catch(() => {})
  return next
}
async function ask(message, details) {
  if (process.send) {
    const id = randomUUID()
    const answer = new Promise((done) => {
      process.once('message', (reply) => done(reply?.id === id && reply.accept === true))
    })
    report({ type: 'confirm', id, message, details })
    if (!await answer) {
      throw new Error('已暂缓执行')
    }
    return
  }
  if (!process.stdin.isTTY) {
    throw new Error('请在交互式终端执行本次确认')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    if ((await prompt.question(message + ' 输入 yes 继续：')).trim() !== 'yes') {
      throw new Error('已停止')
    }
  } finally {
    prompt.close()
  }
}

async function run() {
  if (args.some((arg) => !['--resume', '--revise', '--plan', '--retry', '--help'].includes(arg)) || (args.includes('--retry') && !resume)) {
    throw new Error('参数无效，使用 pnpm release --help')
  }
  if (args.includes('--help')) {
    console.info('pnpm release [--plan | --resume [--retry] | --revise]；配置见根目录「更新与发布清单.md」')
    return
  }
  const { plan, steps, targets } = await loadPlan()
  for (const n of releaseGraph({ plan, steps, targets }).filter((n) => n.step)) {
    console.info(n.label + ' ← ' + n.deps.join('、'))
  }
  console.info('上线范围：' + [plan.ui && '主界面 ' + plan.ui, ...targets.map((t) => t.id + ' ' + t.version)].filter(Boolean).join('、'))
  console.info('更新说明：\n' + plan.notes)
  if (args.includes('--plan')) {
    return
  }
  let state = releaseState()
  const key = planKey(plan)
  if (completedPlan(state, key)) {
    throw new Error('此计划已完成，请更新 release-plan.json 后再开始新一批发布')
  }
  if (process.env.TBOX_EXPECT_PLAN && process.env.TBOX_EXPECT_PLAN !== key) {
    throw new Error('预览后计划发生变化，请重新确认')
  }
  enter('prepare')
  const api = httpsUrl(process.env.TBOX_RELEASE_API, 'TBOX_RELEASE_API')
  const web = httpsUrl(process.env.TBOX_RELEASE_WEB, 'TBOX_RELEASE_WEB')
  if (git('branch', '--show-current') !== plan.branch) {
    throw new Error('请先切换到 ' + plan.branch)
  }
  let repo
  try {
    repo = command('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  } catch {
    throw new Error('无法读取 GitHub 仓库。请在本机终端运行 gh auth status；未登录时执行 gh auth login，已登录时请检查网络和仓库权限。')
  }
  const origin = git('remote', 'get-url', '--push', 'origin')
  const remoteRepo = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1]
  if (repo.toLowerCase() !== remoteRepo?.toLowerCase()) {
    throw new Error('gh 当前仓库必须与 origin 推送仓库一致')
  }
  function save() {
    writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(statePath + '.tmp', statePath)
  }
  const revise = args.includes('--revise')
  if (revise && (!state || state.complete || resume)) {
    throw new Error('只能在未完成批次上使用 --revise')
  }
  if (!resume && !revise && state && !state.complete) {
    throw new Error('此仓库还有未完成的发布，请用 --resume')
  }
  const request = await adminClient(api, process.env.TBOX_RELEASE_ADMIN_USER, process.env.TBOX_RELEASE_ADMIN_PASSWORD)
  try {
    if (resume) {
      if (!state || state.complete || statePlanKey(state) !== key || state.repo !== repo || state.api !== api || state.web !== web) {
        throw new Error('续跑需要同一计划和发布环境下的未完成记录')
      }
    } else {
      const reused = {}
      if (revise && (state.repo !== repo || state.api !== api || state.web !== web)) {
        throw new Error('修订计划必须使用原发布环境')
      }
      if (revise && Object.values(state.runs).some((r) => r.dispatched && !r.done && r.status !== 'completed')) {
        throw new Error('原批次还有未确认结束的 Actions，请先续跑同步结果')
      }
      const changed = revise ? [git('diff', '--name-only', state.sha), git('ls-files', '--others', '--exclude-standard')].join('\n').split('\n').filter(Boolean) : []
      const apps = (await request('/applications')).applications
      for (const target of targets) {
        const app = apps.find((a) => a.appId === target.id)
        target.expected = app?.currentReleaseId ?? null
        const previous = revise && state.targets.find((t) => t.id === target.id && t.version === target.version)
        if (previous && target.runtime === 'web' && state.runs[target.id]?.done) {
          // A changed shared build input requires a new app version. Other app edits
          // and release tooling/docs alone don't invalidate this immutable candidate.
          if (appInputsChanged(target.id, changed)) {
            throw new Error(target.id + ' 已登记且构建输入变化，请升级该应用版本')
          }
          target.receipt = previous.receipt
          target.expected = previous.expected
          const live = targetEntry({ applications: apps }, target).live
          target.verified = live
          reused[target.id] = { ...state.runs[target.id], reusedFrom: state.sha }
          continue
        }
        if (previous && target.runtime === 'shell' && state.runs.api?.done) {
          target.expected = previous.expected
          target.verified = targetEntry({ applications: apps }, target).live
          continue
        }
        const current = app?.releases.find((e) => e.release.releaseId === target.expected)
        if ((current && !newer(target.version, current.release.manifest.version)) || app?.releases.some((e) => !e.readiness.development && e.release.manifest.version === target.version)) {
          throw new Error(target.id + ' 的目标版本已使用或低于线上版本；请核对本批版本')
        }
      }
      const toolOrIndependentWeb = (path) => /^(?:docs\/|scripts\/(?:local-release|release-dashboard\/)|release-plan\.json$|[^/]+\.md$)/.test(path) || /^apps\/(?!settings\/|market\/)[^/]+\/web\//.test(path)
      const sameHostInputs = revise && changed.every(toolOrIndependentWeb)
      if (plan.deployApi && state?.runs.api?.done && sameHostInputs && targets.filter((t) => t.runtime === 'shell').every((t) => state.targets.some((old) => old.id === t.id && old.version === t.version))) {
        reused.api = state.runs.api
      }
      let ui
      if (plan.ui) {
        const listing = await request('/system-releases')
        if (sameHostInputs && state.ui?.version === plan.ui && state.runs.ui?.done) {
          const row = systemTarget(listing, state.ui)
          reused.ui = state.runs.ui
          ui = { ...state.ui, verified: row.state === 'live' && state.ui.verified }
        } else if (listing.interrupted || (listing.current && !newer(plan.ui, listing.current.version))) {
          throw new Error('主界面版本未高于线上，或有中断的发布待恢复')
        }
        ui ??= { version: plan.ui, expected: listing.current?.build ?? null }
      }
      const status = git('status', '--porcelain', '--untracked-files=all')
      console.info(repo, plan.branch, api, web, '\n' + (status || '工作区已提交'))
      await confirm('确认提交并推送，随后按计划运行生产工作流？', [repo, plan.branch, api, web, ...(revise ? ['修订未完成计划；复用已核验构建：' + (Object.keys(reused).join('、') || '无')] : []), status || '工作区已提交'].join('\n'))
      if (planKey((await loadPlan()).plan) !== key || git('status', '--porcelain', '--untracked-files=all') !== status) {
        throw new Error('确认期间计划或文件清单发生变化，请重新开始')
      }
      if (status) {
        git('add', '--all')
        git('commit', '-m', 'release: ' + plan.notes.split('\n')[0])
      }
      const completedPlans = { ...state?.completedPlans }
      if (state?.complete) {
        completedPlans[statePlanKey(state)] = { sha: state.sha, at: state.completedAt }
      }
      if (revise) {
        writeFileSync(statePath + '.' + state.batch + '.json', JSON.stringify(state, null, 2), { mode: 0o600 })
      }
      state = { completedPlans, planKey: key, sha: git('rev-parse', 'HEAD'), repo, api, web, targets, ui, runs: reused, batch: randomUUID() }
      save()
    }
    if (!state.pushed) {
      git('push', 'origin', state.sha + ':refs/heads/' + plan.branch)
      state.pushed = true
      save()
    }
    const graph = releaseGraph({ plan, steps, targets: state.targets })
    state.progress ??= {}
    const resumeIds = graph.filter((n) => nodeDone(n, state)).map((n) => n.id)
    async function execute(n) {
      if (n.step) {
        const step = n.step
        const record = state.runs[step.key] ??= { key: state.sha + '-' + state.batch + '-' + step.key }
        await waitForWorkflow({ step, record, sha: state.sha, repo, branch: plan.branch, save, confirm, retry: args.includes('--retry') })
        const target = step.kind === 'ui' ? state.ui : state.targets.find((t) => t.id === step.id)
        if (target) {
          target.receipt = await workflowReceipt(repo, record, step)
        }
        if (step.kind === 'ui') {
          systemTarget(await request('/system-releases'), target)
        } else {
          const apps = await request('/applications')
          const verify = step.kind === 'api' ? state.targets.filter((t) => t.runtime === 'shell') : [target]
          verify.forEach((t) => targetEntry(apps, t))
        }
        record.done = true
      } else if (n.id === 'approve') {
        const apps = await request('/applications')
        state.targets.forEach((t) => targetEntry(apps, t))
        if (state.ui) {
          systemTarget(await request('/system-releases'), state.ui)
        }
        enter('approve')
        await confirm('候选构建已核对，确认按上述清单正式上线？')
        state.approved = true
      } else if (n.id === 'publish-ui') {
        await publishUi(request, state.ui, plan.notes, web)
        state.ui.verified = true
      } else {
        const target = state.targets.find((t) => t.id === n.target)
        await publishApp(request, target, plan.notes)
        target.verified = true
      }
    }
    await executeGraph(graph, resumeIds, execute, (n, status, reason) => {
      const progress = state.progress[n.id] ??= {}
      progress.status = status
      progress.updatedAt = new Date().toISOString()
      if (reason) {
        progress.error = reason
        ;(progress.failures ??= []).push({ at: progress.updatedAt, reason })
      } else {
        delete progress.error
      }
      save()
    }, (n) => n.pool === 'app' && state.runs[n.step.key]?.dispatched && !state.runs[n.step.key].done && state.runs[n.step.key].status !== 'completed')
    state.planKey = key
    state.completedAt = new Date().toISOString()
    state.complete = true
    save()
    console.info('发布完成，提交 ' + state.sha)
  } finally {
    await request('/session', 'DELETE').catch(() => {})
  }
}

if (process.send) {
  process.once('disconnect', () => process.exit(1))
}

const lock = statePath + '.lock'
let locked = false
try {
  if (!args.some((a) => ['--plan', '--help'].includes(a))) {
    mkdirSync(lock)
    locked = true
    writeFileSync(resolve(lock, 'pid'), String(process.pid))
    process.once('exit', () => {
      if (locked) {
        rmSync(lock, { recursive: true, force: true })
      }
    })
    process.once('SIGINT', () => process.exit(130))
    process.once('SIGTERM', () => process.exit(143))
  }
  await run()
} catch (error) {
  report({ type: 'failure', node: currentNode, message: error.message })
  console.error(error.code === 'EEXIST' ? '已有本地发版进程或遗留锁：' + lock : error.message)
  process.exitCode = 1
} finally {
  if (locked) {
    rmSync(lock, { recursive: true, force: true })
    locked = false
  }
}

if (process.connected) {
  process.removeAllListeners('disconnect')
  process.disconnect()
}
