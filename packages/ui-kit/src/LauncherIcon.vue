<script setup lang="ts">
import { AppIcon } from "@t-box/ui-kit";
defineProps<{ appId: string; icon: string; day?: number }>();
</script>
<template>
  <span
    class="launcher-icon"
    :class="`launcher-icon--${appId}`"
    aria-hidden="true"
  >
    <template v-if="appId === 'calculator'">
      <span class="calculator-screen">π + e</span>
      <span class="calculator-keys"
        ><i></i><i></i><i></i><i></i><i></i><i></i
      ></span>
    </template>
    <template v-else-if="appId === 'calendar'">
      <span class="calendar-icon-top">日历</span
      ><span class="calendar-icon-day">{{ day }}</span>
    </template>
    <svg v-else-if="appId === 'time'" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="22" stroke="currentColor" stroke-width="3" />
      <path
        d="M32 17v16l11 7"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      <circle cx="32" cy="32" r="3" fill="currentColor" />
    </svg>
    <svg v-else-if="appId === 'ledger'" viewBox="0 0 64 64" fill="none">
      <rect
        x="15"
        y="12"
        width="35"
        height="41"
        rx="7"
        fill="white"
        fill-opacity=".95"
      />
      <path d="M23 12v41" stroke="#b9ece3" stroke-width="2" />
      <path
        d="M32 24h9M32 32h9M32 40h6"
        stroke="#21897e"
        stroke-width="3"
        stroke-linecap="round"
      />
      <path
        d="M18 20h-5M18 30h-5M18 40h-5"
        stroke="white"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
    <AppIcon
      v-else-if="appId === 'profile'"
      class="settings-launcher-glyph"
      name="settings"
      :size="36"
    />
    <AppIcon v-else :name="icon" :size="32" />
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
.launcher-icon svg {
  width: 90%;
  height: 90%;
}
.launcher-icon--ledger {
  background: linear-gradient(145deg, #48bda9, #168374);
}
.launcher-icon--calculator {
  background: linear-gradient(155deg, #566174, #2d3748);
  padding: calc(var(--icon-size, 68px) * 0.14)
    calc(var(--icon-size, 68px) * 0.17);
  flex-direction: column;
  gap: calc(var(--icon-size, 68px) * 0.07);
}
.calculator-screen {
  background: #b9d3c5;
  color: #314c43;
  width: 100%;
  height: calc(var(--icon-size, 68px) * 0.23);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-radius: 4px;
  font:
    600 calc(var(--icon-size, 68px) * 0.145) ui-monospace,
    monospace;
  text-align: right;
  padding: 2px calc(var(--icon-size, 68px) * 0.05);
}
.calculator-keys {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: calc(var(--icon-size, 68px) * 0.055);
  width: 100%;
  height: calc(var(--icon-size, 68px) * 0.31);
  flex-shrink: 0;
}
.calculator-keys i {
  background: #d1dae5;
  border-radius: 3px;
}
.calculator-keys i:nth-child(3n) {
  background: #e9ad72;
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
.launcher-icon--time {
  background: linear-gradient(145deg, #71a7ec, #4473c3);
}
.launcher-icon--profile {
  background: linear-gradient(145deg, #8d9aaa, #56687f);
}
.launcher-icon .settings-launcher-glyph {
  width: 58%;
  height: 58%;
}
</style>
