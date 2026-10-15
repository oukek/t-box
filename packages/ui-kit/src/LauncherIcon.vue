<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { clockHandAngles, useLauncherClock } from './launcherClock'

const props = withDefaults(defineProps<{ appId?: string, icon: string, iconAsset?: string, iconVariant?: 'image' | 'calendar' | 'clock', day?: number, animate?: boolean }>(), { animate: true })
const live = useLauncherClock(() => props.animate && (props.iconVariant === 'calendar' || props.iconVariant === 'clock'))
const preview = new Date(2000, 0, 1, 10, 10, 0)
const angles = computed(() => clockHandAngles(props.animate ? live.value : preview))
const calendarDay = computed(() => props.day ?? (props.animate ? live.value.getDate() : new Date().getDate()))
const failed = ref(false)
watch(() => props.iconAsset, () => {
  failed.value = false
})
</script>

<template>
  <span
    class="launcher-icon"
    :class="{ 'launcher-icon--image': iconAsset && !failed, 'launcher-icon--calendar': iconVariant === 'calendar', 'launcher-icon--clock': iconVariant === 'clock' }"
    aria-hidden="true"
  >
    <template v-if="iconVariant === 'calendar'">
      <span class="calendar-icon-top">日历</span><span class="calendar-icon-day">{{ calendarDay }}</span>
    </template>
    <svg
      v-else-if="iconVariant === 'clock'"
      class="live-clock"
      viewBox="0 0 64 64"
      fill="none"
    >
      <circle
        cx="32"
        cy="32"
        r="22"
        stroke="currentColor"
        stroke-width="3"
      />
      <path
        d="M32 32V19"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
        :transform="`rotate(${angles.hour} 32 32)`"
      />
      <path
        d="M32 32V14"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        :transform="`rotate(${angles.minute} 32 32)`"
      />
      <path
        class="clock-second-hand"
        d="M32 36V11"
        stroke="#ffe0c6"
        stroke-width="1.2"
        stroke-linecap="round"
        :transform="`rotate(${angles.second} 32 32)`"
      />
      <circle
        cx="32"
        cy="32"
        r="2.5"
        fill="currentColor"
      />
    </svg>
    <img
      v-else-if="iconAsset && !failed"
      :src="iconAsset"
      alt=""
      draggable="false"
      @error="failed = true"
    >
    <AppIcon
      v-else
      :name="icon"
      :size="32"
    />
  </span>
</template>

<style scoped>
.launcher-icon {
  width: var(--icon-size, 68px);
  height: var(--icon-size, 68px);
  border-radius: 23%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  color: white;
  background: #617d99;
  box-shadow:
    0 5px 10px #20395816,
    inset 0 1px 0 #ffffff55;
  overflow: hidden;
  flex-shrink: 0;
}
.launcher-icon--image {
  background: transparent;
}
.launcher-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.launcher-icon--calendar {
  background: #fff;
  flex-direction: column;
  justify-content: flex-start;
  color: #29364c;
  box-shadow:
    0 5px 10px #20395816,
    inset 0 0 0 1px #ffffffa0;
}
.calendar-icon-top {
  background: #e8867d;
  color: white;
  width: 100%;
  height: 31%;
  font-size: clamp(7px, calc(var(--icon-size, 68px) * 0.15), 12px);
  font-weight: 600;
  display: grid;
  place-items: center;
}
.calendar-icon-day {
  display: grid;
  place-items: center;
  font:
    500 calc(var(--icon-size, 68px) * 0.47)/1 -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  letter-spacing: -2px;
  flex: 1;
  width: 100%;
  padding-right: 2px;
}
.launcher-icon--clock {
  background: linear-gradient(145deg, #71a7ec, #4473c3);
}
.live-clock {
  width: 90%;
  height: 90%;
}
</style>
