import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { adminClient, httpsUrl, publishApp, publishUi, systemTarget, targetEntry } from './local-release-admin.mjs'
import { command, readReceipt, waitForWorkflow } from './local-release-github.mjs'
import { completedPlan, loadPlan, planKey, releaseState, root, statePath, statePlanKey, versionPattern } from './local-release-plan.mjs'

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

async function confirm(message, details = '') {
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
  if (args.some((arg) => !['--resume', '--plan', '--retry', '--help'].includes(arg)) || (args.includes('--retry') && !resume)) {
    throw new Error('参数无效，使用 pnpm release --help')
  }
  if (args.includes('--help')) {
    console.info('pnpm release [--plan | --resume [--retry]]；配置见根目录「更新与发布清单.md」')
    return
  }
  const { plan, steps, targets } = await loadPlan()
  steps.forEach((s, i) => console.info((i + 1) + '. ' + s.label))
  console.info('上线顺序：' + [plan.ui && '主界面 ' + plan.ui, ...targets.map((t) => t.id + ' ' + t.version)].filter(Boolean).join(' → '))
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
  if (!resume && state && !state.complete) {
    throw new Error('此仓库还有未完成的发布，请用 --resume')
  }
  const request = await adminClient(api, process.env.TBOX_RELEASE_ADMIN_USER, process.env.TBOX_RELEASE_ADMIN_PASSWORD)
  try {
    if (resume) {
      if (!state || state.complete || state.sha !== git('rev-parse', 'HEAD') || state.repo !== repo || state.api !== api || state.web !== web || git('status', '--porcelain')) {
        throw new Error('续跑需要未完成的本地记录、原提交、干净工作区以及相同的发布环境')
      }
    } else {
      const apps = (await request('/applications')).applications
      for (const target of targets) {
        const app = apps.find((a) => a.appId === target.id)
        target.expected = app?.currentReleaseId ?? null
        const current = app?.releases.find((e) => e.release.releaseId === target.expected)
        if ((current && !newer(target.version, current.release.manifest.version)) || app?.releases.some((e) => !e.readiness.development && e.release.manifest.version === target.version)) {
          throw new Error(target.id + ' 的目标版本已使用或低于线上版本；请核对本批版本')
        }
      }
      let ui
      if (plan.ui) {
        const listing = await request('/system-releases')
        if (listing.interrupted || (listing.current && !newer(plan.ui, listing.current.version))) {
          throw new Error('主界面版本未高于线上，或有中断的发布待恢复')
        }
        ui = { version: plan.ui, expected: listing.current?.build ?? null }
      }
      const status = git('status', '--porcelain', '--untracked-files=all')
      console.info(repo, plan.branch, api, web, '\n' + (status || '工作区已提交'))
      await confirm('确认提交并推送，随后按计划运行生产工作流？', [repo, plan.branch, api, web, status || '工作区已提交'].join('\n'))
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
      state = { completedPlans, planKey: key, sha: git('rev-parse', 'HEAD'), repo, api, web, targets, ui, runs: {}, batch: randomUUID() }
      save()
    }
    if (!state.pushed) {
      git('push', 'origin', state.sha + ':refs/heads/' + plan.branch)
      state.pushed = true
      save()
    }
    for (const step of steps) {
      const record = state.runs[step.key] ??= { key: state.sha + '-' + state.batch + '-' + step.key }
      if (!record.done) {
        enter('build-' + step.key)
        await waitForWorkflow({ step, record, sha: state.sha, repo, branch: plan.branch, save, confirm, retry: args.includes('--retry') })
        if (step.kind !== 'api') {
          const log = command('gh', ['run', 'view', String(record.id), '--repo', repo, '--log'])
          const target = step.kind === 'ui' ? state.ui : state.targets.find((t) => t.id === step.id)
          target.receipt = readReceipt(log, step)
        }
        if (step.kind === 'ui') {
          systemTarget(await request('/system-releases'), state.ui)
        } else {
          const apps = await request('/applications')
          const verify = state.targets.filter((t) => step.kind === 'api' ? t.runtime === 'shell' : t.id === step.id)
          verify.forEach((t) => targetEntry(apps, t))
        }
        record.done = true
        save()
      }
    }
    enter('approve')
    const apps = await request('/applications')
    state.targets.forEach((t) => targetEntry(apps, t))
    if (state.ui) {
      systemTarget(await request('/system-releases'), state.ui)
    }
    if (!state.approved) {
      await confirm('候选构建已核对，确认按上述清单正式上线？')
      state.approved = true
      save()
    }
    if (state.ui) {
      enter('publish-ui')
      await publishUi(request, state.ui, plan.notes, web)
      state.ui.verified = true
      save()
      console.info('已核验公网主界面 ' + state.ui.version)
    }
    for (const target of state.targets) {
      enter('publish-' + target.id)
      await publishApp(request, target, plan.notes)
      target.verified = true
      save()
      console.info('已核验线上版本 ' + target.id + ' ' + target.version)
    }
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
