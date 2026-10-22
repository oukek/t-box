<script setup lang="ts">
import type {
  CreativeFrame,
  PlaybackSettings,
} from '@t-box/baby-diary-contracts'
import {
  babyAge,
  frameTransform,
  playbackPosition,
  projectFrames,
} from '@t-box/baby-diary-core'
import { SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { baby, errorText, imageUrl, onPrivateClear } from './runtime'

const props = defineProps<{
  frames: CreativeFrame[]
  settings: PlaybackSettings
}>()
const from = ref('')
const to = ref('')
const playing = ref(false)
const elapsed = ref(0)
const error = ref('')
const speed = ref(1)
const urls = reactive<Record<string, string>>({})
const frames = computed(() =>
  projectFrames(props.frames, from.value, to.value),
)
const position = computed(() =>
  playbackPosition(elapsed.value, frames.value.length, props.settings),
)
const current = computed(() => frames.value[position.value.index])
const next = computed(() => frames.value[position.value.next])
const loading = computed(
  () =>
    !!current.value &&
    (!urls[current.value.assetId] || !urls[next.value?.assetId || '']),
)
const overlay = computed(() =>
  !current.value
    ? ''
    : props.settings.overlay === 'age'
      ? babyAge(baby.value?.birthDate || null, current.value.date)
      : props.settings.overlay === 'date'
        ? current.value.date
        : '',
)
const progress = computed(() => position.value.progress)
const currentStyle = computed(() => ({
  opacity: props.settings.transition === 'fade' ? 1 - progress.value : 1,
  transform: `${props.settings.transition === 'slide' ? `translateX(${-progress.value * 100}%) ` : props.settings.transition === 'zoom' ? `scale(${1 + progress.value * 0.15}) ` : ''}${current.value ? frameTransform(current.value) : ''}`,
}))
const nextStyle = computed(() => ({
  opacity:
    props.settings.transition === 'fade'
      ? progress.value
      : props.settings.transition === 'slide'
        ? 1
        : 0,
  transform: `${props.settings.transition === 'slide' ? `translateX(${(1 - progress.value) * 100}%) ` : ''}${next.value ? frameTransform(next.value) : ''}`,
}))
let raf = 0
let last = 0
let version = 0
const inflight = new Set<string>()
watch(
  [current, next],
  (values) => {
    for (const frame of values) {
      if (!frame || urls[frame.assetId] || inflight.has(frame.assetId)) {
        continue
      }
      const generation = version
      const id = frame.assetId
      inflight.add(id)
      void imageUrl(id)
        .then((url) => {
          if (generation !== version) {
            return
          }
          urls[id] = url
          const keep = new Set([current.value?.assetId, next.value?.assetId])
          for (const key of Object.keys(urls)) {
            if (!keep.has(key)) {
              delete urls[key]
            }
          }
        })
        .catch((e) => {
          if (generation === version) {
            error.value = errorText(e)
            playing.value = false
          }
        })
        .finally(() => inflight.delete(id))
    }
  },
  { immediate: true },
)
function tick(now: number) {
  if (!playing.value) {
    return
  }
  if (!loading.value && last) {
    elapsed.value += Math.min(now - last, 100) * speed.value
  }
  last = now
  if (position.value.done) {
    playing.value = false
    return
  }
  raf = requestAnimationFrame(tick)
}
watch(playing, (value) => {
  cancelAnimationFrame(raf)
  last = 0
  if (value) {
    if (position.value.done) {
      elapsed.value = 0
    }
    raf = requestAnimationFrame(tick)
  }
})
watch([from, to, () => props.settings.reverse, () => props.frames], () => {
  playing.value = false
  elapsed.value = 0
})
function step(direction: number) {
  playing.value = false
  elapsed.value = Math.max(
    0,
    Math.min(
      (frames.value.length - 1) * props.settings.frameMs,
      Math.floor(elapsed.value / props.settings.frameMs) *
      props.settings.frameMs +
      direction * props.settings.frameMs,
    ),
  )
}
const stop = onPrivateClear(() => {
  version++
  playing.value = false
  for (const key of Object.keys(urls)) {
    delete urls[key]
  }
})
onBeforeUnmount(() => {
  version++
  cancelAnimationFrame(raf)
  stop()
})
</script>

<template>
  <div class="creative-player">
    <div
      class="player-canvas"
      :style="{
        aspectRatio: settings.aspect.replace(':', '/'),
        width: `min(100%, 360px, ${(47 * Number(settings.aspect.split(':')[0])) / Number(settings.aspect.split(':')[1])}dvh)`,
      }"
    >
      <template v-if="current"><img
                                 v-if="urls[current.assetId]"
                                 :src="urls[current.assetId]"
                                 :style="currentStyle"
                                 alt="当前成长照片"
                               ><img
                                 v-if="next && urls[next.assetId]"
                                 :src="urls[next.assetId]"
                                 :style="nextStyle"
                                 alt="下一张成长照片"
                               ><span v-if="overlay" class="player-overlay">{{ overlay }}</span>
        <p v-if="current.caption" class="player-caption">
          {{ current.caption }}
        </p>
        <span
          v-if="loading"
          class="player-loading"
        >正在读取私有照片…</span></template>
      <p v-else>这个日期范围还没有照片</p>
    </div>
    <div class="player-controls">
      <button
        class="round-button"
        :disabled="!frames.length"
        aria-label="上一张"
        @click="step(-1)"
      >
        ‹</button><button
        class="primary play-button"
        :disabled="!frames.length"
        @click="playing = !playing"
      >
        {{ playing ? "暂停" : "播放成长动画" }}</button><button
        class="round-button"
        :disabled="!frames.length"
        aria-label="下一张"
        @click="step(1)"
      >
        ›</button><small>{{ frames.length ? position.index + 1 : 0 }}/{{ frames.length }}</small>
    </div>
    <label class="speed-control">播放速度<SheetSelect
      v-model="speed"
      label="播放速度"
      :options="
        [0.25, 0.5, 1, 2, 4, 8].map((value) => ({
          value,
          label: `${value} 倍速`,
        }))
      "
    /></label>
    <details class="date-filters">
      <summary>选择播放日期范围</summary>
      <div class="two-columns">
        <label>从<DateField
          v-model="from"
          label="播放开始日期"
          clearable
        /></label><label>到<DateField
          v-model="to"
          label="播放结束日期"
          clearable
        /></label>
      </div>
    </details>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <p class="subtle">照片在设备上播放，不会发送给 AI 或第三方图片服务。</p>
  </div>
</template>
