<script setup lang="ts">
import type { RuntimeDescriptor } from '@t-box/app-contracts'
import { onBeforeUnmount, ref, watch } from 'vue'
import { connectFrame, descriptor } from './bridge'

const props = defineProps<{
  appId: string
  params: Record<string, string>
  openRevision: number
  initializeRuntime?: (runtime: RuntimeDescriptor) => Promise<void>
}>()
const locationOrigin = location.origin
const frame = ref<HTMLIFrameElement>()
const runtime = ref<RuntimeDescriptor>()
const error = ref('')
const loading = ref(true)
let epoch = 0
let connection: ReturnType<typeof connectFrame> | undefined
async function load() {
  const generation = ++epoch
  connection?.close()
  runtime.value = undefined
  loading.value = true
  error.value = ''
  try {
    const next = await descriptor(props.appId)
    await props.initializeRuntime?.(next)
    if (generation === epoch) {
      runtime.value = next
    }
  } catch (e) {
    if (generation === epoch) {
      error.value = e instanceof Error ? e.message : '应用打开失败'
      loading.value = false
    }
  }
}
async function connected() {
  if (!frame.value || !runtime.value) {
    return
  }
  const generation = epoch
  let attempt: ReturnType<typeof connectFrame> | undefined
  connection?.close()
  try {
    attempt = connectFrame(frame.value, runtime.value, props.params)
    connection = attempt
    await attempt.promise
    if (generation === epoch && connection === attempt) {
      loading.value = false
    }
  } catch (e) {
    // A second iframe load replaces the channel without changing the runtime epoch.
    // Its predecessor's rejected handshake must not hide the newly connected frame.
    if (generation === epoch && (!attempt || connection === attempt)) {
      loading.value = false
      error.value = e instanceof Error ? e.message : '应用连接失败'
    }
  }
}
watch(
  () => [props.appId, props.openRevision],
  () => void load(),
  { immediate: true },
)
onBeforeUnmount(() => {
  epoch++
  connection?.close()
})
</script>

<template>
  <section class="web-application">
    <p
      v-if="loading"
      class="runtime-status"
      role="status"
    >正在打开应用…</p>
    <div
      v-if="error"
      class="runtime-error"
      role="alert"
    >
      <p>{{ error }}</p>
      <button class="button button-secondary" @click="load">重新打开</button>
    </div>
    <iframe
      v-if="runtime && !error"
      ref="frame"
      :key="`${runtime.appId}:${openRevision}`"
      :src="`${runtime.entryUrl}#tbox-host=${encodeURIComponent(locationOrigin)}`"
      :title="appId === 'calculator' ? '数学计算器' : appId"
      sandbox="allow-scripts allow-same-origin"
      referrerpolicy="strict-origin-when-cross-origin"
      allow=""
      @load="connected"
    />
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
.runtime-status {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 16px;
  background: white;
  z-index: 1;
}
.runtime-error {
  padding: 24px;
  text-align: center;
}
</style>
