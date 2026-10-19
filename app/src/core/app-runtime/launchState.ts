import type { InjectionKey } from 'vue'
import { shallowRef } from 'vue'

export type LaunchStage = 'resolving' | 'resources' | 'loading' | 'connecting' | 'ready' | 'failed'
export function createLaunchState() {
  const stage = shallowRef<LaunchStage>('resolving')
  const appNavigation = shallowRef(false)
  const resourceProgress = shallowRef<{ completed: number, total: number }>()
  let webRuntime = false
  return {
    stage,
    appNavigation,
    resourceProgress,
    registerWebRuntime() {
      webRuntime = true
    },
    pending() {
      stage.value = 'resolving'
      resourceProgress.value = undefined
      appNavigation.value = false
    },
    resolved() {
      if (!webRuntime && stage.value !== 'failed') {
        stage.value = 'ready'
      }
    },
    update(value: LaunchStage) {
      stage.value = value
    },
  }
}
export const launchStateKey: InjectionKey<ReturnType<typeof createLaunchState>> = Symbol('application-launch')

/** Estimated progress remains below completion until the component or SDK handshake is ready. */
export function advanceLaunchProgress(current: number, stage: LaunchStage) {
  if (stage === 'ready') {
    return 1
  }
  if (stage === 'failed') {
    return current
  }
  const ceiling = { resolving: 0.25, resources: 0.62, loading: 0.78, connecting: 0.92 }[stage]
  return Math.max(current, Math.min(ceiling, current + (ceiling - current) * 0.12 + 0.003))
}
export const launchStageLabels = {
  resolving: '正在读取启动信息',
  resources: '正在准备并校验本地资源',
  loading: '正在加载应用页面',
  connecting: '正在连接应用',
  ready: '已就绪',
  failed: '启动失败',
} satisfies Record<LaunchStage, string>
