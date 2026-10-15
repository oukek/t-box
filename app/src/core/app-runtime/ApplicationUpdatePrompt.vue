<script setup lang="ts">
import type { ApplicationUpdateInfo } from '@t-box/app-contracts'
import { Modal } from '@t-box/ui-kit'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { openApplication } from '../navigation'
import { identity } from '../session'
import { appCatalog } from './catalog'
import { availableUpdate, updatePrompts } from './updatePrompts'

const props = defineProps<{ appId: string, ready: boolean }>()
const entry = computed(() => appCatalog.entries.find((item) => item.release.appId === props.appId))
const update = computed(() => props.ready ? availableUpdate(entry.value) : null)
const shown = ref<ApplicationUpdateInfo | null>(null)
const error = ref('')
const busy = ref(false)
// Shared across application remounts; cleared on identity change and bounded per session.
const dismissed = new Set<string>()
let epoch = 0
let timer: ReturnType<typeof setTimeout> | undefined
let attempting = false
let disposed = false
const key = (info: ApplicationUpdateInfo) => `${identity.user?.id}:${info.appId}:${info.releaseId}`
function dismiss() {
  if (busy.value) {
    return
  }
  if (shown.value) {
    rememberUpdate(key(shown.value))
  }
  shown.value = null
}
function rememberUpdate(value: string) {
  dismissed.add(value)
  if (dismissed.size > 256) {
    dismissed.delete(dismissed.values().next().value!)
  }
  try {
    sessionStorage.setItem('tbox.update-prompts', JSON.stringify({ user: identity.user?.id, keys: [...dismissed] }))
  } catch { /* Session memory remains available. */ }
}
watch(() => identity.user?.id, (user) => {
  dismissed.clear()
  try {
    const saved = JSON.parse(sessionStorage.getItem('tbox.update-prompts') || 'null')
    if (saved?.user === user && Array.isArray(saved.keys)) {
      for (const value of saved.keys.slice(-256)) {
        if (typeof value === 'string') {
          dismissed.add(value)
        }
      }
    }
  } catch { /* Invalid session preferences are ignored. */ }
}, { immediate: true })
watch(() => update.value ? key(update.value) : '', () => {
  epoch++
  attempting = false
  clearTimeout(timer)
  shown.value = null
  error.value = ''
  updatePrompts.cancel(props.appId)
}, { flush: 'sync' })
async function attempt() {
  const info = update.value
  if (disposed || attempting || shown.value || !info || dismissed.has(key(info)) || document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) {
    return
  }
  attempting = true
  const started = epoch
  const customShown = await updatePrompts.request(info)
  if (disposed || started !== epoch) {
    return
  }
  attempting = false
  if (customShown) {
    rememberUpdate(key(info))
  } else if (!document.querySelector('dialog[open]') && document.visibilityState === 'visible') {
    shown.value = info
  }
}
// Delay until launch completes and existing forms/password prompts have closed.
timer = setTimeout(() => void attempt(), 750)
const poll = setInterval(() => void attempt(), 1000)
async function visitMarket() {
  if (!shown.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  const info = shown.value
  try {
    await openApplication({ appId: 'market', params: { appId: info.appId } })
    rememberUpdate(key(info))
    shown.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '应用市场打开失败，请重试'
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => {
  disposed = true
  epoch++
  clearTimeout(timer)
  clearInterval(poll)
  updatePrompts.cancel(props.appId)
})
</script>

<template>
  <Modal
    :open="Boolean(shown)"
    :title="shown?.prompt.title?.trim() || '发现新版本'"
    :busy="busy"
    @close="dismiss"
  >
    <div v-if="shown" class="application-update">
      <div class="application-update-identity">
        <LauncherIcon
          v-if="entry"
          :app-id="appId"
          :icon="entry.release.manifest.icon"
          :icon-asset="entry.release.manifest.iconAsset"
          :icon-variant="entry.release.manifest.iconVariant"
        />
        <div><strong>{{ shown.name }}</strong><p>v{{ shown.installedVersion }}<span aria-hidden="true"> → </span><b>v{{ shown.version }}</b></p></div>
      </div>
      <p class="application-update-description">{{ shown.prompt.description?.trim() || '新版本已上架，前往应用市场查看并更新。' }}</p>
      <p v-if="shown.releaseNotes" class="application-update-notes">{{ shown.releaseNotes }}</p>
      <p
        v-if="error"
        class="application-update-error"
        role="alert"
      >{{ error }}</p>
    </div>
    <template #footer><button
      class="button button-secondary"
      :disabled="busy"
      @click="dismiss"
    >{{ shown?.prompt.deferText?.trim() || '稍后' }}</button><button
      class="button button-primary"
      :disabled="busy"
      @click="visitMarket"
    >{{ busy ? '正在打开…' : shown?.prompt.confirmText?.trim() || '前往更新' }}</button></template>
  </Modal>
</template>

<style scoped>
.application-update-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}
.application-update-identity :deep(.launcher-icon) {
  width: 48px;
  height: 48px;
  border-radius: 13px;
  flex: 0 0 48px;
}
.application-update-identity strong {
  font-size: 16px;
  font-weight: 620;
}
.application-update-identity p {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.application-update-identity span {
  padding: 0 7px;
}
.application-update-identity b {
  font-weight: 500;
  color: var(--accent);
}
.application-update-description {
  font-size: 14px;
  overflow-wrap: anywhere;
  line-height: 1.7;
  margin: 20px 0 0;
}
.application-update-notes {
  max-height: 28dvh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--surface-soft, #f3f6f5);
  padding: 12px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0 0;
}
.application-update-error {
  font-size: 13px;
  color: var(--danger);
}
</style>
