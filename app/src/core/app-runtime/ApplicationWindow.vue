<script setup lang="ts">
import type { ApplicationManifest } from '@t-box/shared'
import type { WindowPosition, WindowViewport } from './windowGeometry'
import { AppIcon } from '@t-box/ui-kit'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { applicationPhone, applicationWindowSize, constrainApplicationWindow, initialApplicationWindow } from './windowGeometry'

defineProps<{ application: ApplicationManifest }>()
const emit = defineEmits<{ close: [] }>()
function visibleViewport(): WindowViewport {
  const viewport = window.visualViewport
  return { width: viewport?.width || innerWidth, height: viewport?.height || innerHeight, left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0 }
}
const viewport = ref(visibleViewport())
const expanded = ref(false)
const size = computed(() => applicationWindowSize(viewport.value, expanded.value))
const position = ref(initialApplicationWindow(size.value, viewport.value))
const scale = computed(() => size.value.width / applicationPhone.width)
const drag = ref<{ id: number, startX: number, startY: number, origin: WindowPosition } | null>(null)
const style = computed(() => ({ width: `${size.value.width}px`, height: `${size.value.height}px`, left: `${position.value.x}px`, top: `${position.value.y}px` }))
const phoneStyle = computed(() => ({ width: `${applicationPhone.width}px`, height: `${applicationPhone.height}px`, transform: `scale(${scale.value})` }))
function move(next: WindowPosition) {
  position.value = constrainApplicationWindow(next, size.value, viewport.value)
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary) {
    return
  }
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  drag.value = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...position.value } }
}
function dragTo(event: PointerEvent) {
  if (drag.value?.id === event.pointerId) {
    move({ x: drag.value.origin.x + event.clientX - drag.value.startX, y: drag.value.origin.y + event.clientY - drag.value.startY })
  }
}
function endDrag() {
  drag.value = null
}
function moveWithKeys(event: KeyboardEvent) {
  const directions: Record<string, WindowPosition> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
  const direction = directions[event.key]
  if (direction) {
    event.preventDefault()
    const step = event.shiftKey ? 40 : 10
    move({ x: position.value.x + direction.x * step, y: position.value.y + direction.y * step })
  } else if (event.key === 'Home') {
    event.preventDefault()
    position.value = initialApplicationWindow(size.value, viewport.value)
  }
}
function toggleSize() {
  const before = size.value
  expanded.value = !expanded.value
  move({ x: position.value.x + (before.width - size.value.width) / 2, y: position.value.y + (before.height - size.value.height) / 2 })
}
function resize() {
  endDrag()
  viewport.value = visibleViewport()
  move(position.value)
}
onMounted(() => {
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('scroll', resize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('scroll', resize)
})
</script>

<template>
  <section
    class="application-window"
    :class="{ 'application-window--dragging': drag, 'application-window--compact': size.width < 180 }"
    :style="style"
    :aria-label="`${application.name}应用浮窗`"
    :data-expanded="expanded"
  >
    <header class="application-window__toolbar" @keydown.esc.stop="emit('close')">
      <button
        class="application-window__drag"
        :aria-label="`移动${application.name}浮窗，使用方向键调整位置`"
        title="拖动移动，方向键微调，Home 复位"
        @pointerdown="startDrag"
        @pointermove="dragTo"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @keydown="moveWithKeys"
      >
        <LauncherIcon
          :icon="application.icon"
          :icon-asset="application.iconAsset"
          :icon-variant="application.iconVariant"
        />
        <span>{{ application.name }}</span>
        <i class="application-window__grip" aria-hidden="true" />
      </button>
      <button
        v-if="size.width >= 96"
        class="application-window__control"
        :aria-label="expanded ? '缩小应用浮窗' : '放大应用浮窗'"
        :title="expanded ? '缩小' : '放大'"
        :aria-pressed="expanded"
        @click="toggleSize"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        ><path :d="expanded ? 'M9 3v6H3 M15 21v-6h6 M3 9l6-6 M15 21l6-6' : 'M8 3H3v5 M16 21h5v-5 M3 3l6 6 M21 21l-6-6'" /></svg>
      </button>
      <button
        class="application-window__control application-window__close"
        :aria-label="`关闭${application.name}浮窗`"
        title="关闭浮窗"
        @click="emit('close')"
      ><AppIcon name="close" :size="17" /></button>
    </header>
    <div class="application-window__viewport">
      <div class="application-window__phone" :style="phoneStyle"><slot /></div>
    </div>
  </section>
</template>

<style scoped>
.application-window {
  position: fixed;
  z-index: 20;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  border: 0;
  outline: 1px solid #cdded7;
  border-radius: 18px;
  background: #fff;
  box-shadow:
    0 18px 64px #193c3526,
    0 3px 12px #193c3512;
  overflow: hidden;
}
.application-window__toolbar {
  height: 44px;
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  padding: 2px 3px 2px 7px;
  gap: 1px;
  background: #f3f8f5;
  border-bottom: 1px solid #e0eae4;
}
.application-window__drag {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #294c40;
  gap: 8px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.application-window__drag :deep(.launcher-icon) {
  --icon-size: 22px;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-self: center;
  border-radius: 6px;
}
.application-window__drag span {
  align-self: center;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.application-window__grip {
  margin: auto 3px auto auto;
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  background: radial-gradient(circle, #9bafa4 1px, transparent 1.5px) 0 0 / 4px 4px;
}
.application-window__control {
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #6c8176;
}
.application-window__control:hover,
.application-window__drag:hover {
  background: #e5efe9;
}
.application-window__close:hover {
  background: #f6e8e6;
  color: #a04b43;
}
.application-window__control:focus-visible,
.application-window__drag:focus-visible {
  outline: 2px solid #27867c;
  outline-offset: -2px;
}
.application-window__viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.application-window__phone {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: top left;
  isolation: isolate;
  overflow: auto;
  overscroll-behavior: contain;
  --visible-height: 844px;
  --navigation-space: 0px;
  --workspace-top: 0px;
}
.application-window__phone :deep(.application-workspace) {
  width: 100%;
  max-width: none;
  margin: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.application-window--dragging .application-window__drag {
  cursor: grabbing;
}
.application-window--dragging .application-window__viewport {
  pointer-events: none;
}
.application-window--compact .application-window__toolbar {
  padding: 2px;
}
.application-window--compact .application-window__drag {
  padding: 0 2px;
  gap: 0;
}
.application-window--compact .application-window__drag :deep(.launcher-icon),
.application-window--compact .application-window__grip {
  display: none;
}
.application-window--compact .application-window__control {
  flex-basis: 32px;
  width: 32px;
}
</style>
