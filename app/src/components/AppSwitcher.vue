<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'
import { onBeforeUnmount, ref } from 'vue'

const panel = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const nativePopover = typeof HTMLElement.prototype.showPopover === 'function'
const opened = ref(false)
function show() {
  if (nativePopover) {
    panel.value?.showPopover()
  } else {
    opened.value = true
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
function cancelHide() {
  clearTimeout(timer)
}
function hover(event: PointerEvent) {
  cancelHide()
  if (event.pointerType === 'mouse') {
    show()
  }
}
function leave(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    timer = setTimeout(() => {
      if (!panel.value?.contains(document.activeElement)) {
        close()
      }
    }, 220)
  }
}
function close() {
  cancelHide()
  if (nativePopover) {
    panel.value?.hidePopover()
  }
  opened.value = false
}
defineExpose({ close })
onBeforeUnmount(cancelHide)
</script>

<template>
  <button
    ref="trigger"
    class="switch-bubble"
    type="button"
    aria-label="切换应用"
    aria-haspopup="dialog"
    aria-controls="app-switch-panel"
    :aria-expanded="opened"
    :popovertarget="nativePopover ? 'app-switch-panel' : undefined"
    popovertargetaction="show"
    @click="!nativePopover && show()"
    @pointerenter="hover"
    @pointerleave="leave"
  >
    <AppIcon name="copy" :size="21" />
  </button>
  <div
    v-if="!nativePopover && opened"
    class="switch-backdrop"
    @pointerdown="close"
  />
  <section
    v-show="nativePopover || opened"
    id="app-switch-panel"
    ref="panel"
    :popover="nativePopover ? 'auto' : undefined"
    role="dialog"
    aria-label="已打开的应用"
    class="switch-panel"
    :class="{ fallback: !nativePopover }"
    @keydown.esc.stop="close(); trigger?.focus()"
    @toggle="opened = panel?.matches(':popover-open') ?? false"
    @pointerenter="cancelHide"
    @pointerleave="leave"
  >
    <header><strong>已打开的应用</strong><button aria-label="收起列表" @click="close(); trigger?.focus()"><AppIcon name="close" :size="16" /></button></header>
    <slot />
  </section>
</template>

<style scoped>
.switch-bubble,
.switch-panel {
  left: max(10px, env(safe-area-inset-left));
  position: fixed;
}
.switch-bubble {
  bottom: calc(16% + env(safe-area-inset-bottom));
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 0;
  width: 46px;
  height: 46px;
  border-radius: 16px;
  border: 1px solid #fff9;
  color: white;
  background: #29394def;
  box-shadow: 0 3px 14px #11243c38;
  cursor: pointer;
}
.switch-panel {
  inset: auto auto calc(16% + env(safe-area-inset-bottom) + 52px) max(10px, env(safe-area-inset-left));
  margin: 0;
  width: min(272px, calc(100vw - 24px));
  max-height: 65dvh;
  overflow: auto;
  padding: 8px 12px;
  border: 1px solid #dbe1e8;
  border-radius: 18px;
  background: #fafbfe;
  color: #243247;
  box-shadow: 0 10px 40px #10203438;
}
.switch-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9;
}
.switch-panel.fallback {
  z-index: 10;
}
.switch-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 4px;
  font-size: 13px;
}
.switch-panel header button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  background: none;
  border: 0;
  cursor: pointer;
  color: #657488;
}
</style>
