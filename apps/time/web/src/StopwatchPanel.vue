<script setup lang="ts">
import type { StopwatchState } from './stopwatch'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { application, identity, preferences } from './runtime'
import {
  durationLabel,
  parseStopwatch,
  stopwatchElapsed,
} from './stopwatch'

const now = ref(Date.now())
const stopwatch = ref<StopwatchState>({ elapsed: 0, startedAt: null, laps: [] })
let preferenceOwner = ''
watch(
  () => identity.user?.id,
  (id) => {
    preferenceOwner = id ?? ''
    stopwatch.value = { elapsed: 0, startedAt: null, laps: [] }
    if (id) {
      try {
        stopwatch.value = parseStopwatch(preferences.stopwatch)
      } catch {}
    }
  },
  { immediate: true, flush: 'sync' },
)
watch(() => preferences.loaded, (loaded) => {
  if (loaded && preferenceOwner && preferenceOwner === identity.user?.id) {
    stopwatch.value = parseStopwatch(preferences.stopwatch)
  }
})
const elapsed = computed(() => stopwatchElapsed(stopwatch.value, now.value))
let ticker: ReturnType<typeof setInterval> | undefined
function persistStopwatch() {
  if (!preferenceOwner || preferenceOwner !== identity.user?.id) {
    return
  }
  try {
    preferences.stopwatch = JSON.parse(JSON.stringify(stopwatch.value))
    void application.client.storage.set('time.stopwatch.v1', preferences.stopwatch).catch(() => {})
  } catch {}
}
function toggleStopwatch() {
  if (!preferenceOwner || preferenceOwner !== identity.user?.id) {
    return
  }
  now.value = Date.now()
  if (stopwatch.value.startedAt === null) {
    stopwatch.value.startedAt = now.value
  } else {
    stopwatch.value.elapsed = elapsed.value
    stopwatch.value.startedAt = null
  }
  persistStopwatch()
}
function lap() {
  if (stopwatch.value.startedAt === null || stopwatch.value.laps.length >= 200) {
    return
  }
  stopwatch.value.laps.push(stopwatchElapsed(stopwatch.value, Date.now()))
  persistStopwatch()
}
function resetStopwatch() {
  stopwatch.value = { elapsed: 0, startedAt: null, laps: [] }
  persistStopwatch()
}
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 40)
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  persistStopwatch()
})
</script>

<template>
  <div>
    <div class="time-stopwatch">
      <span>秒表</span>
      <p class="time-stopwatch-digits">
        {{ durationLabel(elapsed, true) }}
      </p>
      <div class="time-stopwatch-actions">
        <button
          class="button button-secondary"
          :disabled="
            stopwatch.startedAt === null || stopwatch.laps.length >= 200
          "
          @click="lap"
        > 分段</button><button class="button button-primary" @click="toggleStopwatch">
          {{
            stopwatch.startedAt === null ? (elapsed ? "继续" : "开始") : "暂停"
          }}
        </button><button
          class="button button-secondary"
          :disabled="stopwatch.startedAt !== null || !elapsed"
          @click="resetStopwatch"
        >
          重置
        </button>
      </div>
      <p class="temporal-note">
        本机保存，最多 200
        个分段；关闭后按设备时间继续计时，调整设备时间会影响结果。
      </p>
    </div>
    <div v-if="stopwatch.laps.length" class="time-laps">
      <header><span>分段</span><span>本段用时</span><span>累计</span></header>
      <div v-for="(value, index) in [...stopwatch.laps].reverse()" :key="index">
        <strong>{{
          String(stopwatch.laps.length - index).padStart(2, "0")
        }}</strong><span>{{
          durationLabel(
            value - (stopwatch.laps[stopwatch.laps.length - index - 2] || 0),
            true,
          )
        }}</span><span>{{ durationLabel(value, true) }}</span>
      </div>
    </div>
  </div>
</template>
