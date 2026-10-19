<script setup lang="ts">
import type { ApplicationManifest } from '@t-box/shared'
import type { LaunchStage } from './launchState'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { advanceLaunchProgress, launchStageLabels } from './launchState'

const props = defineProps<{ application: ApplicationManifest, stage: LaunchStage, resourceProgress?: { completed: number, total: number } }>()
const visible = ref(false)
const progress = ref(0.08)
const elapsed = ref(0)
let startedAt = 0
let timer: ReturnType<typeof setInterval> | undefined
let reveal: ReturnType<typeof setTimeout> | undefined
let finish: ReturnType<typeof setTimeout> | undefined
let shownAt = 0
let running = false
function clearTimers() {
  clearInterval(timer)
  clearTimeout(reveal)
  clearTimeout(finish)
  timer = reveal = finish = undefined
}
watch(() => props.stage, (stage) => {
  if (stage === 'failed') {
    clearTimers()
    running = visible.value = false
  } else if (stage === 'ready') {
    clearTimers()
    running = false
    progress.value = 1
    if (visible.value) {
      finish = setTimeout(() => {
        visible.value = false
      }, Math.max(140, 240 - (performance.now() - shownAt)))
    }
  } else if (!running) {
    clearTimers()
    running = true
    progress.value = 0.08
    startedAt = performance.now()
    elapsed.value = 0
    // Cached applications can open without flashing a transient screen.
    reveal = setTimeout(() => {
      visible.value = true
      shownAt = performance.now()
    }, 100)
    timer = setInterval(() => {
      progress.value = advanceLaunchProgress(progress.value, props.stage)
      elapsed.value = Math.floor((performance.now() - startedAt) / 1000)
    }, 120)
  }
}, { immediate: true })
watch(() => props.resourceProgress, (value) => {
  if (value && value.total > 0) {
    progress.value = Math.max(progress.value, 0.25 + value.completed / value.total * 0.37)
  }
})
onBeforeUnmount(clearTimers)
</script>

<template>
  <Transition name="application-launch">
    <div
      v-if="visible"
      class="application-launch"
      role="status"
      aria-live="polite"
    >
      <div class="application-launch-identity">
        <LauncherIcon
          :icon="application.icon"
          :icon-asset="application.iconAsset"
          :icon-variant="application.iconVariant"
        />
        <span>{{ application.name }}</span>
      </div>
      <div class="application-launch-footer">
        <span class="sr-only">正在打开{{ application.name }}…</span>
        <span class="application-launch-caption">{{ launchStageLabels[stage] }}<template v-if="resourceProgress && stage === 'resources'"> {{ resourceProgress.completed }}/{{ resourceProgress.total }}</template></span>
        <span v-if="elapsed >= 5 && stage !== 'ready'" class="application-launch-wait">已等待 {{ elapsed }} 秒</span>
        <div class="application-launch-track" aria-hidden="true"><i :style="{ transform: `scaleX(${progress})` }" /></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.application-launch {
  position: fixed;
  inset: 0;
  z-index: 12;
  background: #f4f6f8;
  display: grid;
  place-items: center;
  padding: env(safe-area-inset-top) 24px env(safe-area-inset-bottom);
}
.application-launch-identity {
  --icon-size: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  transform: translateY(-24px);
}
.application-launch-identity > span:last-child {
  font-size: 13px;
  font-weight: 500;
  color: #657780;
  letter-spacing: 0.04em;
}
.application-launch-footer {
  position: absolute;
  bottom: max(44px, calc(24px + env(safe-area-inset-bottom)));
  width: min(180px, 44vw);
}
.application-launch-track {
  height: 3px;
  overflow: hidden;
  border-radius: 3px;
  background: #dfe7e8;
}
.application-launch-caption {
  display: block;
  margin-bottom: 12px;
  text-align: center;
  font-size: 12px;
  color: #657780;
}
.application-launch-wait {
  display: block;
  text-align: center;
  color: #8b989e;
  font-size: 11px;
  margin: -5px 0 12px;
}
.application-launch-track i {
  display: block;
  width: 100%;
  height: 100%;
  background: #27867c;
  border-radius: inherit;
  transform-origin: left;
  transition: transform 0.18s linear;
}
.application-launch-leave-active {
  transition: opacity 0.14s ease;
}
.application-launch-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .application-launch-track i,
  .application-launch-leave-active {
    transition: none;
  }
}
</style>
