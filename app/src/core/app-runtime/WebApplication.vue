<script setup lang="ts">
import type { RuntimeDescriptor } from '@t-box/app-contracts'
import type { LaunchStage } from './launchState'
import type { ApplicationPackage } from './resources/contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { AppIcon } from '@t-box/ui-kit'
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { ErrorCode } from '../../error-codes'
import { getApplication } from '../applications'
import { backFromApplication } from '../navigation'
import { request } from '../network'
import { identity } from '../session'
import ApplicationLaunch from './ApplicationLaunch.vue'
import { connectFrame, descriptor } from './bridge'
import { refreshCatalog } from './catalog'
import { checkDevelopmentEntry } from './developmentEntry'
import { launchStateKey } from './launchState'
import { localApplications } from './localApplications'
import { applicationResources } from './resources'
import { applicationPackage } from './resources/manager'
import { LaunchRecovery } from './resources/recovery'
import { measureLaunch } from './resources/telemetry'
import { APPLICATION_FRAME_SANDBOX } from './sandbox'

const props = defineProps<{
  appId: string
  params: Record<string, string>
  openRevision: number
  initializeRuntime?: (runtime: RuntimeDescriptor) => Promise<void>
  persistentNavigation?: boolean
}>()
const launch = inject(launchStateKey, undefined)
launch?.registerWebRuntime()
const stage = ref<LaunchStage>('resolving')
const application = computed(() => getApplication(props.appId))
function updateStage(value: LaunchStage) {
  stage.value = value
  launch?.update(value)
}
const locationOrigin = location.origin
const nativeHost = window.Capacitor?.isNativePlatform?.() === true
const frame = ref<HTMLIFrameElement>()
const runtime = ref<RuntimeDescriptor>()
const error = ref('')
const loading = ref(true)
let epoch = 0
let connection: ReturnType<typeof connectFrame> | undefined
let pkg: ApplicationPackage | undefined
let authorizedRuntime: RuntimeDescriptor | undefined
let measured: ReturnType<typeof measureLaunch> | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let failing = false
const recovery = new LaunchRecovery(applicationResources)
const recoveryNotice = ref('')
async function fail(cause: unknown, generation: number) {
  if (generation !== epoch || failing) {
    return
  }
  failing = true
  clearTimeout(deadline)
  connection?.close()
  const failed = authorizedRuntime
  const rollbackUser = identity.user?.id
  const rollbackToken = identity.token
  if (failed && identity.user && navigator.onLine) {
    try {
      const recovered = await recovery.recover(failed, {
        current: () => generation === epoch && identity.user?.id === rollbackUser && identity.token === rollbackToken,
        started: () => measured?.mark('rollback'),
        async rollback(failedReleaseId, releaseId) {
          return (await request<{ data: { status: string } }>(`/applications/${encodeURIComponent(props.appId)}/rollback`, {
            method: 'POST',
            body: JSON.stringify({ failedReleaseId, releaseId }),
          })).data
        },
      })
      if (generation !== epoch) {
        return
      }
      if (recovered) {
        measured?.finish('rolled_back', cause)
        await refreshCatalog({ silent: true })
        recoveryNotice.value = '新版启动失败，已恢复上一个可用版本'
        failing = false
        void load()
        return
      }
    } catch { /* A stale installation or incompatible backend must not bypass server authorization. */ }
  }
  measured?.finish('failed', cause)
  updateStage('failed')
  error.value = cause instanceof Error ? cause.message : '应用打开失败'
  loading.value = false
  failing = false
}
async function load() {
  clearTimeout(deadline)
  measured?.finish('cancelled')
  measured = measureLaunch(props.appId)
  const generation = ++epoch
  authorizedRuntime = undefined
  pkg = undefined
  failing = false
  connection?.close()
  runtime.value = undefined
  loading.value = true
  error.value = ''
  if (launch) {
    launch.resourceProgress.value = undefined
  }
  updateStage('resolving')
  try {
    const next = await descriptor(props.appId)
    if (generation !== epoch) {
      return
    }
    measured.report.releaseId = next.releaseId
    authorizedRuntime = next
    pkg = applicationPackage(next)
    if (!pkg && !navigator.onLine) {
      throw SdkErrorCode.NETWORK_REQUIRED('当前应用使用在线开发资源。离线使用需要先安装正式构建的应用资源')
    }
    if (import.meta.env.DEV && !pkg) {
      updateStage('loading')
      await checkDevelopmentEntry(props.appId, next.entryUrl)
    }
    updateStage('resources')
    measured.mark('preparing')
    const local = pkg
      ? await applicationResources.open(pkg, (progress) => {
          if (generation === epoch && launch) {
            launch.resourceProgress.value = progress
          }
        })
      : { entryUrl: next.entryUrl, origin: next.origin, source: 'development' as const }
    if (generation !== epoch) {
      return
    }
    measured.report.source = local.source
    await props.initializeRuntime?.(next)
    if (generation === epoch) {
      updateStage('loading')
      measured.mark('loading')
      runtime.value = { ...next, entryUrl: local.entryUrl, origin: local.origin }
      deadline = setTimeout(() => void fail(ErrorCode.INTERNAL_APPLICATION_RESOURCES_TIMEOUT('应用页面加载超时，请检查应用资源和开发服务后重试'), generation), 30_000)
    }
  } catch (e) {
    await fail(e, generation)
  }
}
async function connected() {
  if (!frame.value || !runtime.value) {
    return
  }
  const generation = epoch
  loading.value = true
  updateStage('connecting')
  measured?.mark('connecting')
  let attempt: ReturnType<typeof connectFrame> | undefined
  connection?.close()
  try {
    attempt = connectFrame(frame.value, runtime.value, props.params)
    connection = attempt
    const client = await attempt.promise
    if (generation === epoch && connection === attempt) {
      if (launch) {
        launch.appNavigation.value = client.appNavigation
      }
      loading.value = false
      clearTimeout(deadline)
      if (pkg) {
        applicationResources.healthy(runtime.value!.subject, pkg)
      }
      measured?.finish('ready')
      updateStage('ready')
    }
  } catch (e) {
    // A second iframe load replaces the channel without changing the runtime epoch.
    // Its predecessor's rejected handshake must not hide the newly connected frame.
    if (generation === epoch && (!attempt || connection === attempt)) {
      await fail(e, generation)
    }
  }
}
watch(
  () => [props.appId, props.openRevision],
  (next, old) => {
    if (props.persistentNavigation && next[0] === old?.[0] && connection && runtime.value && !error.value) {
      void connection.promise.then((client) => client.navigate({ ...props.params })).catch(() => {})
    } else {
      void load()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(deadline)
  measured?.finish('cancelled')
  epoch++
  connection?.close()
})
async function repairAndLoad() {
  const target = pkg
  const shipped = nativeHost && target && localApplications.releases.some((release) => release.appId === target.appId && release.runtime.type === 'web' && release.runtime.integrity === `sha256-${target.digest}`)
  if (!navigator.onLine && !shipped) {
    error.value = '资源修复需要联网，请连接网络后重试'
    return
  }
  if (!target) {
    return load()
  }
  const started = ++epoch
  clearTimeout(deadline)
  connection?.close()
  runtime.value = undefined
  loading.value = true
  error.value = ''
  updateStage('resources')
  try {
    await applicationResources.repair(target)
    if (started === epoch) {
      await load()
    }
  } catch (cause) {
    if (started !== epoch) {
      return
    }
    error.value = cause instanceof Error ? cause.message : '资源修复失败'
    loading.value = false
    updateStage('failed')
  }
}
</script>

<template>
  <section class="web-application" :aria-busy="loading">
    <ApplicationLaunch
      v-if="!launch && application"
      :application="application"
      :stage="stage"
    />
    <div
      v-if="error"
      class="runtime-error"
      role="alert"
    >
      <button
        class="icon-button runtime-error-back"
        aria-label="返回"
        @click="backFromApplication"
      ><AppIcon name="left" :size="21" /></button>
      <p>{{ error }}</p>
      <button class="button button-secondary" @click="load">重新打开</button>
      <button
        v-if="pkg"
        class="button button-secondary"
        @click="repairAndLoad"
      >修复资源</button>
    </div>
    <iframe
      v-if="runtime && !error"
      ref="frame"
      :key="`${runtime.appId}:${persistentNavigation ? runtime.generation : openRevision}`"
      :src="`${runtime.entryUrl}#tbox-host=${encodeURIComponent(locationOrigin)}${nativeHost ? '&tbox-local=1' : ''}`"
      :title="application?.name || appId"
      :class="{ 'runtime-frame--loading': loading }"
      :aria-hidden="loading"
      :inert="loading"
      :sandbox="APPLICATION_FRAME_SANDBOX"
      referrerpolicy="strict-origin-when-cross-origin"
      allow="clipboard-write"
      @load="connected"
    />
    <p
      v-if="recoveryNotice && !loading && !error"
      class="runtime-recovery"
      role="status"
      @click="recoveryNotice = ''"
    >{{ recoveryNotice }}</p>
  </section>
</template>

<style scoped>
.web-application {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
iframe {
  border: 0;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #f5f7fa;
}
.runtime-frame--loading {
  visibility: hidden;
  pointer-events: none;
}
.runtime-error {
  position: relative;
  padding: 24px;
  text-align: center;
}
.runtime-error-back {
  position: absolute;
  left: 0;
  top: 0;
}
.runtime-recovery {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: max(16px, env(safe-area-inset-bottom));
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: #edf7f3;
  color: #286751;
  text-align: center;
  font-size: 12px;
}
</style>
