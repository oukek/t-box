import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export function command(binary, args, inherit = false) {
  const env = { ...process.env }
  delete env.TBOX_RELEASE_ADMIN_PASSWORD
  return execFileSync(binary, args, {
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  })?.trim()
}

export async function waitForWorkflow({ step, record, sha, repo, branch, save, retry, confirm, gh = (args) => command('gh', args), sleep = delay }) {
  const call = (args) => gh([...args, '--repo', repo])
  const json = (args) => JSON.parse(call(args))
  function dispatch() {
    // Save the correlation key before sending. A lost HTTP response can still mean a successful dispatch.
    const remote = gh(['api', 'repos/' + repo + '/commits/' + encodeURIComponent(branch), '--jq', '.sha'])
    if (remote !== sha) {
      throw new Error('远端分支已变化，请检查本次提交')
    }
    record.dispatched = true
    save()
    const fields = { ...step.inputs, release_key: record.key }
    call(['workflow', 'run', step.workflow, '--ref', branch, ...Object.entries(fields).flatMap(([k, v]) => ['-f', k + '=' + v])])
  }
  const fresh = !record.dispatched
  if (fresh) {
    dispatch()
  }
  async function findRun() {
    for (let i = 0; !record.id && i < 24; i++) {
      const runs = json(['run', 'list', '--workflow', step.workflow, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '100', '--json', 'databaseId,displayTitle,headSha'])
      const found = runs.filter((r) => r.displayTitle === record.key)
      if (found.length > 1 || (found.length && found[0].headSha !== sha)) {
        throw new Error('运行编号不唯一或分支提交已变化，请核对 GitHub 运行记录')
      }
      if (found.length) {
        record.id = found[0].databaseId
        save()
      } else {
        await sleep(5000)
      }
    }
  }
  await findRun()
  if (!record.id && retry && !fresh) {
    await confirm('GitHub 未列出跟踪编号 ' + record.key + '，请核实未启动后确认重新派发。')
    dispatch()
    await findRun()
  }
  if (!record.id) {
    throw new Error('尚未找到对应运行，请核对 Actions 后用 --resume 继续；确认未派发可用 --resume --retry。跟踪编号 ' + record.key)
  }
  const url = 'https://github.com/' + repo + '/actions/runs/' + record.id
  console.info(step.label, url)
  let lastStatus
  let retriedAttempt
  for (;;) {
    const run = json(['run', 'view', String(record.id), '--json', 'headSha,displayTitle,status,conclusion,attempt'])
    if (run.headSha !== sha || run.displayTitle !== record.key) {
      throw new Error('运行与本次提交不匹配')
    }
    if (run.status !== lastStatus) {
      console.info(step.label + ' · ' + run.status)
      lastStatus = run.status
    }
    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        return
      }
      if (retry && retriedAttempt === undefined && ['failure', 'cancelled', 'timed_out'].includes(run.conclusion)) {
        call(['run', 'rerun', String(record.id), ...(run.conclusion === 'failure' ? ['--failed'] : [])])
        retriedAttempt = run.attempt
      } else if (run.attempt !== retriedAttempt) {
        throw new Error(step.label + ' · ' + run.conclusion + '。修复配置后可用 --resume --retry 重跑此任务。')
      }
    }
    await sleep(10000)
  }
}

export function readReceipt(log, step) {
  if (step.kind === 'api') {
    return null
  }
  const pattern = step.kind === 'ui'
    ? /Reserved system build: ([a-f0-9-]{36})\s*$/gm
    : /Build registered: ([\w-]+) ([\d.]+), release ([\w.-]+), status (?:published|submitted)\. Publication requires an administrator\.\s*$/gm
  const ids = new Set()
  for (const match of log.matchAll(pattern)) {
    if (step.kind === 'ui') {
      ids.add(match[1])
    } else if (match[1] === step.id && match[2] === step.version) {
      ids.add(match[3])
    }
  }
  if (ids.size !== 1) {
    throw new Error('运行日志缺少唯一的目标构建回执：' + step.label)
  }
  return [...ids][0]
}
