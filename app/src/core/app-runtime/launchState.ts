import type { InjectionKey } from 'vue'
import { shallowRef } from 'vue'

export type LaunchStage = 'resolving' | 'resources' | 'connecting' | 'ready' | 'failed'
export function createLaunchState() {
  const stage = shallowRef<LaunchStage>('resolving')
  let webRuntime = false
  return {
    stage,
    registerWebRuntime() {
      webRuntime = true
    },
    pending() {
      stage.value = 'resolving'
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
  const ceiling = { resolving: 0.35, resources: 0.72, connecting: 0.92 }[stage]
  return Math.max(current, Math.min(ceiling, current + (ceiling - current) * 0.12 + 0.003))
}
