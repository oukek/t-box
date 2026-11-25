<script setup lang="ts">
import type { ReleaseProgress } from './activate'
import type { DesktopOffer, DesktopProgress } from './desktopTransfer'
import { compareSystemVersions } from '@t-box/app-contracts'
import { Modal } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { activateRelease } from './activate'
import { desktopChecks } from './desktopCheck'
import { readTransfer, startupTransfer } from './desktopTransfer'
import { systemVersionOpen } from './systemVersion'

const props = defineProps<{ enabled: boolean }>()
const coreVersion = ref('')
const desktop = !!window.__TBOX_DESKTOP_KEY__
const runningVersion = __APP_VERSION__
const initial = startupTransfer.current?.busy ? startupTransfer.current : undefined
const offer = ref<DesktopOffer | undefined>(initial?.offer)
const nativeProgress = ref<DesktopProgress | undefined>(initial?.progress)
const target = ref(initial?.offer?.id || '')
if (initial) {
  systemVersionOpen.value = true
}
const targetVersion = ref('')
const busy = ref(!!initial)
const checking = ref(false)
const progress = ref<ReleaseProgress>()
const switching = ref(false)
const message = ref('')
const error = ref('')
const lastChecked = ref('')
const timestampKey = desktop ? 'tbox.desktop-release.last-checked' : 'tbox.web-release.last-checked'
let dismissed = ''
let timer: number | undefined
let mounted = false
let closeCount = 0
let snapshotTimer: number | undefined
const percent = computed(() => {
  const p = nativeProgress.value
  if (!p) {
    return undefined
  }
  if (p.download_total && p.completed_bytes !== undefined) {
    return Math.min(100, Math.floor(100 * p.completed_bytes / p.download_total))
  }
  if (!(offer.value?.ui && offer.value?.core) && p.total) {
    return Math.min(100, Math.floor(100 * p.bytes / p.total))
  }
  return undefined
})
function componentStatus(kind: 'core' | 'ui') {
  const p = nativeProgress.value
  if (kind === (p?.component ?? (p?.phase.includes('核心') ? 'core' : 'ui')) && p) {
    return p.phase
  }
  return p?.component === 'core' && kind === 'ui' ? '已校验' : '等待中'
}
function pollTransfer() {
  if (mounted && busy.value) {
    snapshotTimer = window.setTimeout(() => {
      void recoverTransfer().catch(pollTransfer)
    }, 500)
  }
}
async function recoverTransfer() {
  const status = await readTransfer()
  if (!mounted) {
    return false
  }
  if (status.busy) {
    offer.value = status.offer
    target.value = status.offer?.id || ''
    nativeProgress.value = status.progress
    busy.value = true
    systemVersionOpen.value = true
    pollTransfer()
    return true
  }
  if (busy.value) {
    busy.value = false
    error.value = status.error || ''
  }
  return false
}

let ready = false
let offline = navigator.onLine === false
let reconnected = false
const checks = desktopChecks(async (manual) => {
  const started = closeCount
  checking.value = true
  error.value = ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<DesktopOffer | undefined>('check_system', { key: window.__TBOX_DESKTOP_KEY__, ui: runningVersion })
    if (!mounted || offline) {
      return false
    }
    offer.value = result
    target.value = result?.id || ''
    lastChecked.value = new Date().toISOString()
    try {
      localStorage.setItem(timestampKey, lastChecked.value)
    } catch { /* In-memory timestamp is still visible. */ }
    message.value = result ? '发现可用更新' : '已是最新版本'
    if (result && started === closeCount && (manual() || dismissed !== result.id)) {
      systemVersionOpen.value = true
    }
    return true
  } catch (cause) {
    offer.value = undefined
    target.value = ''
    message.value = typeof cause === 'string' ? cause : '暂时无法检查更新，请稍后重试。'
    return false
  } finally {
    checking.value = false
  }
}, () => mounted && ready && !busy.value && !offline && !document.hidden)
function desktopForeground() {
  if (document.hidden || offline || !ready || busy.value) {
    return
  }
  if (reconnected) {
    reconnected = false
    void checks.check('online')
  } else if (!systemVersionOpen.value) {
    void checks.check('foreground')
  }
}
function desktopNetwork(event?: Event) {
  const wasOffline = offline
  offline = event ? event.type === 'offline' : navigator.onLine === false
  if (busy.value) {
    return
  }
  if (offline) {
    target.value = ''
    offer.value = undefined
    message.value = '当前离线，暂时无法检查更新。'
  } else if (wasOffline) {
    reconnected = true
    desktopForeground()
  }
}
async function check(manual = false) {
  if (desktop) {
    if (offline) {
      message.value = '当前离线，暂时无法检查更新。'
    } else {
      await checks.check(manual ? 'manual' : 'foreground')
    }
    return
  }
  if (!props.enabled || busy.value || checking.value || (!manual && document.hidden)) {
    return
  }
  if (!navigator.onLine) {
    message.value = '当前离线，暂时无法检查更新。'
    target.value = ''
    return
  }
  const started = closeCount
  checking.value = true
  error.value = ''
  try {
    const response = await fetch('/web-version.json', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) })
    const marker = response.ok && await response.json()
    if (!marker || typeof marker.build !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(marker.build)) {
      message.value = '暂时无法检查更新，请重试。'
      target.value = ''
      return
    }
    // Older markers only identify their build. Versioned releases must advance numerically.
    const newer = marker.version === undefined || compareSystemVersions(marker.version, runningVersion) > 0
    target.value = newer && marker.build !== __WEB_BUILD_ID__ ? marker.build : ''
    targetVersion.value = target.value ? marker.version || '' : ''
    lastChecked.value = new Date().toISOString()
    try {
      localStorage.setItem(timestampKey, lastChecked.value)
    } catch { /* Still show the current session's timestamp. */ }
    message.value = target.value ? '发现可用更新' : '已是最新版本'
    if (target.value && started === closeCount && (manual || target.value !== dismissed)) {
      systemVersionOpen.value = true
    }
  } catch (cause) {
    offer.value = undefined
    message.value = desktop && typeof cause === 'string' ? cause : '暂时无法检查更新，请检查网络后重试。'
    target.value = ''
  } finally {
    checking.value = false
  }
}
function blockUpdateShortcuts(event: KeyboardEvent) {
  if (busy.value && (event.metaKey || event.ctrlKey || event.altKey || event.key === 'Escape' || event.key === 'F5')) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
function automaticCheck() {
  void check()
}
function close() {
  if (busy.value) {
    return
  }
  closeCount++
  dismissed = target.value
  systemVersionOpen.value = false
  error.value = ''
  if (desktop && ready) {
    checks.resume()
  }
}
async function update() {
  if (busy.value || checking.value || !target.value) {
    return
  }
  busy.value = true
  progress.value = undefined
  switching.value = false
  error.value = ''
  try {
    if (desktop) {
      const { prepareApplicationsForSystemUpdate } = await import('../app-runtime/bridge')
      await prepareApplicationsForSystemUpdate()
      const { invoke, Channel } = await import('@tauri-apps/api/core')
      const channel = new Channel<DesktopProgress>()
      nativeProgress.value = undefined
      channel.onmessage = (value) => {
        nativeProgress.value = value
      }
      await invoke('apply_system', { key: window.__TBOX_DESKTOP_KEY__, id: target.value, progress: channel })
      return
    }
    await activateRelease(target.value, (value) => {
      progress.value = value
    }, () => {
      switching.value = true
    })
    location.reload()
  } catch (cause) {
    busy.value = false
    error.value = desktop && cause instanceof Error ? cause.message : desktop && typeof cause === 'string' ? cause : '新版未能加载，请检查网络后重试。'
  }
}
onMounted(() => {
  window.addEventListener('keydown', blockUpdateShortcuts, true)
  mounted = true
  try {
    const saved = localStorage.getItem(timestampKey)
    if (saved && Number.isFinite(Date.parse(saved))) {
      lastChecked.value = saved
    }
  } catch { /* Storage is optional. */ }
  if (desktop) {
    window.addEventListener('focus', desktopForeground)
    document.addEventListener('visibilitychange', desktopForeground)
    window.addEventListener('online', desktopNetwork)
    window.addEventListener('offline', desktopNetwork)
    void import('@tauri-apps/api/core').then(async ({ invoke }) => {
      const args = { key: window.__TBOX_DESKTOP_KEY__ }
      const [, outcome] = await Promise.all([
        invoke<string>('desktop_version', args).then((core) => {
          coreVersion.value = core
        }),
        invoke<string>('system_ready', { ...args, version: runningVersion }),
      ])
      if (!mounted) {
        return
      }
      ready = true
      if (!outcome && await recoverTransfer().catch(() => false)) {
        return
      }
      if (outcome) {
        busy.value = false
        offer.value = undefined
        target.value = ''
        checks.defer()
        message.value = outcome
        systemVersionOpen.value = true
      } else if (offline) {
        desktopNetwork()
      } else {
        void checks.check('startup')
      }
    }).catch(() => {
      message.value = '桌面更新服务暂不可用。'
    })
    return
  }
  if (!props.enabled) {
    return
  }
  automaticCheck()
  document.addEventListener('visibilitychange', automaticCheck)
  window.addEventListener('online', automaticCheck)
  window.addEventListener('offline', automaticCheck)
  timer = window.setInterval(automaticCheck, 5 * 60000)
})
onBeforeUnmount(() => {
  mounted = false
  checks.dispose()
  clearTimeout(snapshotTimer)
  window.removeEventListener('focus', desktopForeground)
  document.removeEventListener('visibilitychange', desktopForeground)
  window.removeEventListener('online', desktopNetwork)
  window.removeEventListener('offline', desktopNetwork)
  window.removeEventListener('keydown', blockUpdateShortcuts, true)
  clearInterval(timer)
  document.removeEventListener('visibilitychange', automaticCheck)
  window.removeEventListener('online', automaticCheck)
  window.removeEventListener('offline', automaticCheck)
})
</script>

<template>
  <Modal
    :open="systemVersionOpen"
    title="系统版本"
    :busy="busy"
    :hide-close="busy"
    @close="close"
  >
    <p>当前界面版本 <strong>{{ runningVersion }}</strong></p>
    <template v-if="enabled">
      <p>上次成功检查：{{ lastChecked ? new Date(lastChecked).toLocaleString() : '暂无记录' }}</p>
      <p role="status">{{ checking ? '正在检查更新…' : message }} <strong v-if="target && targetVersion">{{ targetVersion }}</strong></p>
      <p v-if="target && !busy">更新后会刷新页面，请先保存正在编辑的内容。</p>
    </template>
    <template v-else-if="desktop">
      <p>桌面核心版本 <strong>{{ coreVersion || '暂未读取' }}</strong></p>
      <p>上次成功检查：{{ lastChecked ? new Date(lastChecked).toLocaleString() : '暂无记录' }}</p>
      <p v-if="(checking || message) && !busy" role="status">{{ checking ? '正在检查更新…' : message }}</p>
      <template v-if="offer">
        <p v-if="offer.ui && !busy">新版界面 <strong>{{ offer.ui }}</strong></p>
        <p v-if="offer.core && !busy">新版核心 <strong>{{ offer.core }}</strong></p>
        <p v-if="offer.notes && !busy">{{ offer.notes }}</p>
        <p v-if="!busy">请先保存正在编辑的内容。更新期间暂时无法使用方舟，{{ offer.core ? '完成后将自动重启。' : '完成后将刷新界面。' }}</p>
      </template>
    </template>
    <p v-else>当前运行环境不支持网页更新检查。</p>
    <div v-if="busy && desktop" class="release-progress">
      <div class="progress-heading"><span role="status">{{ nativeProgress?.phase || '正在准备更新…' }}</span><strong v-if="percent !== undefined">{{ percent }}%</strong></div>
      <progress
        aria-label="本次更新总下载进度"
        :max="100"
        :value="percent"
      />
      <div v-if="offer?.ui" class="component-progress"><span>方舟界面 {{ offer.ui }}</span><span>{{ componentStatus('ui') }}</span></div>
      <div v-if="offer?.core" class="component-progress"><span>桌面核心 {{ offer.core }}</span><span>{{ componentStatus('core') }}</span></div>
    </div>
    <div v-else-if="busy" class="release-progress">
      <span role="status">{{ switching ? '正在切换到新版…' : progress ? '已校验 ' + progress.completed + ' / ' + progress.total + ' 个文件' : '正在准备新版资源…' }}</span>
      <progress
        aria-label="新版资源准备进度"
        :max="progress?.total || 1"
        :value="switching ? progress?.total || 1 : progress?.completed"
      />
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="(enabled || desktop) && !busy" #footer>
      <button
        v-if="target"
        class="button button-secondary"
        @click="close"
      >{{ error && desktop ? '返回旧版' : '稍后' }}</button>
      <button
        class="button"
        :class="target ? 'button-secondary' : 'button-primary'"
        :disabled="checking"
        @click="check(true)"
      >检查更新</button>
      <button
        v-if="target"
        class="button button-primary"
        :disabled="checking"
        @click="update"
      >{{ desktop ? error ? '重试' : offer?.core ? '更新并重启' : '更新并刷新' : '立即更新' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.progress-heading,
.component-progress {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.component-progress {
  font-size: 12px;
}
.progress-heading {
  color: var(--ink);
}

.release-progress {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  color: var(--muted);
  font-size: 13px;
}
.release-progress progress {
  width: 100%;
  height: 6px;
  accent-color: var(--accent, #176d63);
}
</style>
