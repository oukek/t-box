import { createHash } from 'node:crypto'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationChoice, discoverApplications } from './application-builds.mjs'
import { command } from './local-release-github.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const statePath = resolve(root, command('git', ['-C', root, 'rev-parse', '--git-path', 'tbox-local-release.json']))
export const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
export function planKey(plan) {
  return createHash('sha256').update(JSON.stringify([plan.branch, plan.ui, plan.deployApi, plan.notes, Object.entries(plan.applications), ...(plan.uiAfterApi ? [true] : [])])).digest('hex')
}

export function releaseState() {
  return existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null
}

export function statePlanKey(state) {
  if (state?.planKey || !state?.sha) {
    return state?.planKey
  }
  return planKey(JSON.parse(command('git', ['-C', root, 'show', state.sha + ':release-plan.json'])))
}

export function completedPlan(state, key) {
  if (state?.complete && statePlanKey(state) === key) {
    return { sha: state.sha, at: state.completedAt }
  }
  return state?.completedPlans?.[key]
}

export async function loadPlan() {
  const plan = JSON.parse(readFileSync(resolve(root, 'release-plan.json'), 'utf8'))
  const apps = await discoverApplications(root)
  if (typeof plan.branch !== 'string' || !plan.branch || typeof plan.deployApi !== 'boolean' || typeof plan.notes !== 'string' || !plan.notes.trim() || plan.notes.length > 1000 || !plan.applications || Array.isArray(plan.applications) || typeof plan.applications !== 'object') {
    throw new Error('请检查 release-plan.json 的分支、应用、部署开关和更新说明')
  }
  if (plan.uiAfterApi !== undefined && (typeof plan.uiAfterApi !== 'boolean' || (plan.uiAfterApi && (!plan.deployApi || !plan.ui)))) {
    throw new Error('uiAfterApi 需要同时启用 UI 和后端部署')
  }
  const steps = []
  const targets = []
  for (const [id, version] of Object.entries(plan.applications)) {
    if (typeof version !== 'string' || !versionPattern.test(version)) {
      throw new Error('版本格式错误：' + id)
    }
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error('未知的应用 ID')
    }
    const folder = id === 'profile' ? 'settings' : id
    const versions = []
    for (const path of globSync(resolve(root, 'apps', folder, 'contracts/src/**/*.ts'))) {
      const source = readFileSync(path, 'utf8')
      // Application manifests use a flat, literal object at the contracts boundary.
      for (const match of source.matchAll(/export const \w+(?:: ApplicationManifest)? = \{([^{}]*)\}/g)) {
        if (match[1].match(/\bid:\s*'([^']+)'/)?.[1] === id) {
          versions.push(match[1].match(/\bversion:\s*'([^']+)'/)?.[1])
        }
      }
    }
    if (versions.length !== 1 || version !== versions[0]) {
      throw new Error(id + ' 的发版清单与源码 manifest.version 不一致')
    }
    const app = apps.find((a) => a.appId === id)
    if (app) {
      steps.push({ key: id, kind: 'app', id, version, label: '构建 ' + app.title + ' ' + version, workflow: 'application-release.yml', inputs: { application: applicationChoice(app) } })
    } else if (!['profile', 'market'].includes(id) || !plan.deployApi || !plan.ui) {
      throw new Error('未知应用，或内置应用缺少 API 与 UI 部署：' + id)
    }
    targets.push({ id, version, runtime: app ? 'web' : 'shell', receipt: app ? null : id + '-' + version })
  }
  if (plan.deployApi) {
    steps.push({ key: 'api', kind: 'api', label: '部署生产 API（PM2）', workflow: 'api-pm2.yml', inputs: { start_services: 'true' } })
  }
  if (plan.ui !== null) {
    if (plan.ui !== JSON.parse(readFileSync(resolve(root, 'release-versions.json'), 'utf8')).ui) {
      throw new Error('计划的 UI 版本必须匹配 release-versions.json')
    }
    steps.push({ key: 'ui', kind: 'ui', label: '构建共享 UI ' + plan.ui, workflow: 'web-oss.yml', inputs: {} })
  }
  if (!steps.length) {
    throw new Error('没有要发布的组件')
  }
  return { plan, steps, targets }
}

// Include transitive workspace packages bundled into this application's Web build.
export function appInputsChanged(id, changed) {
  const sources = new Map()
  for (const file of globSync(['apps/*/*/package.json', 'packages/*/package.json', 'shared/package.json'], { cwd: root })) {
    const pkg = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
    sources.set(pkg.name, { file, deps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) })
  }
  const directories = new Set(['apps/' + id + '/'])
  const visited = new Set()
  function visit(pkg) {
    if (!pkg || visited.has(pkg.file)) {
      return
    }
    visited.add(pkg.file)
    directories.add(pkg.file.slice(0, -'package.json'.length))
    for (const dep of pkg.deps) {
      visit(sources.get(dep))
    }
  }
  visit([...sources.values()].find((pkg) => pkg.file === 'apps/' + id + '/web/package.json'))
  return changed.some((path) => [...directories].some((dir) => path.startsWith(dir)) ||
    !/^(?:apps\/|docs\/|scripts\/(?:local-release|release-dashboard\/)|release-plan\.json$|[^/]+\.md$)/.test(path))
}
