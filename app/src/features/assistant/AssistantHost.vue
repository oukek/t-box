<script setup lang="ts">
import type { DockPosition, Point, WindowRect } from './geometry'
import { AppIcon } from '@t-box/ui-kit'
import { lockDocumentScroll } from '@t-box/ui-kit/scroll'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { online } from '../../core/connectivity'
import { closeAssistant, navigation, openAssistant } from '../../core/navigation'
import { identity } from '../../core/session'
import ChatPage from '../chat/ChatPage.vue'
import { chatBusy } from '../chat/chatStore'
import { showWechatLogin } from '../identity/wechatLogin'
import { canFloatAssistant, constrainAssistant, dockLauncher, initialAssistant, launcherPoint, readAssistantLayout } from './geometry'

const emit = defineEmits<{ fullscreen: [value: boolean] }>()
const storageKey = 'tbox.assistant.layout.v1'
let saved: ReturnType<typeof readAssistantLayout> = {}
try {
  saved = readAssistantLayout(localStorage.getItem(storageKey))
} catch { /* Device preferences are optional. */ }
function visibleViewport() {
  const v = window.visualViewport
  return { width: v?.width || innerWidth, height: v?.height || innerHeight, left: v?.offsetLeft || 0, top: v?.offsetTop || 0 }
}
const viewport = ref(visibleViewport())
const floating = computed(() => canFloatAssistant(viewport.value))
const expanded = ref(false)
const fullscreen = computed(() => navigation.assistantOpen && (!floating.value || expanded.value))
const dock = ref<DockPosition>(saved.dock || { side: 'right', ratio: 0.72 })
const initialViewport = floating.value ? viewport.value : { width: 1280, height: 800 }
const rect = ref<WindowRect>(constrainAssistant(saved.rect || initialAssistant(initialViewport), initialViewport))
const introduced = ref(saved.introduced || false)
const idle = ref(false)
const coarse = ref(window.matchMedia('(pointer: coarse)').matches)
const unread = ref(false)
const panel = ref<HTMLElement>()
const launcher = ref<HTMLButtonElement>()
const draggedPoint = ref<Point | null>(null)
const point = computed(() => draggedPoint.value || launcherPoint(dock.value, viewport.value))
const drag = ref<{ id: number, kind: 'launcher' | 'move' | 'resize', start: Point, point: Point, rect: WindowRect, moved: boolean } | null>(null)
const tucked = computed(() => idle.value && (coarse.value || !floating.value) && !chatBusy.value && !unread.value)
const launcherLabel = computed(() => chatBusy.value ? '打开方舟 AI，正在处理' : unread.value ? '打开方舟 AI，有新进展' : '打开方舟 AI')
const layerStyle = computed(() => ({ left: `${viewport.value.left}px`, top: `${viewport.value.top}px`, width: `${viewport.value.width}px`, height: `${viewport.value.height}px` }))
const windowStyle = computed(() => fullscreen.value ? {} : ({ left: `${rect.value.x}px`, top: `${rect.value.y}px`, width: `${rect.value.width}px`, height: `${rect.value.height}px` }))
let idleTimer: ReturnType<typeof setTimeout> | undefined
let suppressClick = false
let releaseScroll: (() => void) | undefined
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ dock: dock.value, rect: rect.value, introduced: introduced.value }))
  } catch { /* Continue with in-memory positioning. */ }
}
function wake() {
  idle.value = false
  clearTimeout(idleTimer)
  if (!navigation.assistantOpen && !drag.value) {
    idleTimer = setTimeout(() => {
      idle.value = true
    }, 3500)
  }
}
function open(event: MouseEvent) {
  if (suppressClick && event.detail > 0) {
    suppressClick = false
    return
  }
  suppressClick = false
  introduced.value = true
  save()
  openAssistant()
}
function startDrag(event: PointerEvent, kind: 'launcher' | 'move' | 'resize') {
  if (event.button !== 0 || !event.isPrimary || (kind !== 'launcher' && fullscreen.value)) {
    return
  }
  event.preventDefault()
  wake()
  clearTimeout(idleTimer)
  suppressClick = false
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const bounds = target.getBoundingClientRect()
  const origin = kind === 'launcher' ? { x: bounds.left - viewport.value.left, y: bounds.top - viewport.value.top } : point.value
  drag.value = { id: event.pointerId, kind, start: { x: event.clientX, y: event.clientY }, point: { ...origin }, rect: { ...rect.value }, moved: false }
}
function moveDrag(event: PointerEvent) {
  const active = drag.value
  if (!active || active.id !== event.pointerId) {
    return
  }
  const dx = event.clientX - active.start.x
  const dy = event.clientY - active.start.y
  if (!active.moved && Math.hypot(dx, dy) < 6) {
    return
  }
  active.moved = true
  if (active.kind === 'launcher') {
    draggedPoint.value = { x: Math.max(8, Math.min(viewport.value.width - 64, active.point.x + dx)), y: Math.max(64, Math.min(viewport.value.height - 88, active.point.y + dy)) }
  } else {
    rect.value = constrainAssistant(active.kind === 'move'
      ? { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }
      : { ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy }, viewport.value)
  }
}
function endDrag(event?: PointerEvent) {
  if (!drag.value || (event && event.pointerId !== drag.value.id)) {
    return
  }
  if (drag.value.kind === 'launcher' && drag.value.moved) {
    dock.value = dockLauncher(point.value, viewport.value)
    suppressClick = true
  }
  draggedPoint.value = null
  drag.value = null
  save()
  wake()
}
function adjustWithKeys(event: KeyboardEvent, kind: 'launcher' | 'move' | 'resize') {
  const moves: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
  const delta = moves[event.key]
  if (!delta || (kind !== 'launcher' && fullscreen.value)) {
    return
  }
  event.preventDefault()
  wake()
  const step = event.shiftKey ? 40 : 16
  if (kind === 'launcher') {
    dock.value = { side: delta.x ? (delta.x < 0 ? 'left' : 'right') : dock.value.side, ratio: Math.max(0, Math.min(1, dock.value.ratio + delta.y * 0.08)) }
  } else {
    rect.value = constrainAssistant(kind === 'move'
      ? { ...rect.value, x: rect.value.x + delta.x * step, y: rect.value.y + delta.y * step }
      : { ...rect.value, width: rect.value.width + delta.x * step, height: rect.value.height + delta.y * step }, viewport.value)
  }
  save()
}
function panelKeys(event: KeyboardEvent) {
  // Native dialogs (attachments, confirmations, history) own their focus and Escape.
  if (document.querySelector('dialog[open]')) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAssistant()
  } else if (event.key === 'Tab' && fullscreen.value) {
    const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((el) => el.getClientRects().length)
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
function resize() {
  endDrag()
  viewport.value = visibleViewport()
  coarse.value = window.matchMedia('(pointer: coarse)').matches
  if (floating.value) {
    rect.value = constrainAssistant(rect.value, viewport.value)
  }
}
watch(fullscreen, (value) => {
  emit('fullscreen', value)
  if (value) {
    void nextTick(() => {
      if (!panel.value?.contains(document.activeElement)) {
        panel.value?.focus({ preventScroll: true })
      }
    })
  }
  if (value) {
    releaseScroll ??= lockDocumentScroll()
  } else {
    releaseScroll?.()
    releaseScroll = undefined
  }
}, { immediate: true })
watch(() => navigation.assistantOpen, async (open, previous) => {
  wake()
  if (open) {
    unread.value = false
  }
  await nextTick()
  if (open) {
    panel.value?.focus({ preventScroll: true })
  } else if (previous) {
    launcher.value?.focus({ preventScroll: true })
  }
}, { immediate: true })
watch(() => navigation.revision, () => {
  expanded.value = false
})
watch(chatBusy, (busy, previous) => {
  if (previous && !busy && !navigation.assistantOpen) {
    unread.value = true
  }
})
watch(() => identity.user?.id, () => {
  unread.value = false
})
onMounted(() => {
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('scroll', resize)
  wake()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('scroll', resize)
  clearTimeout(idleTimer)
  releaseScroll?.()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="assistant-layer"
      :style="layerStyle"
    >
      <button
        v-show="!navigation.assistantOpen"
        ref="launcher"
        class="assistant-launcher"
        :class="{ 'is-idle': idle, 'is-tucked': tucked, 'is-left': dock.side === 'left', 'is-dragging': drag?.kind === 'launcher' }"
        :style="{ left: `clamp(calc(8px + env(safe-area-inset-left)), ${point.x}px, calc(100% - 64px - env(safe-area-inset-right)))`, top: `${point.y}px` }"
        :aria-label="launcherLabel"
        aria-haspopup="dialog"
        aria-controls="assistant-window"
        :aria-expanded="navigation.assistantOpen"
        title="方舟 AI · 拖动调整位置，方向键移动"
        @pointerdown="startDrag($event, 'launcher')"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @pointerenter="wake"
        @focus="wake"
        @keydown="adjustWithKeys($event, 'launcher')"
        @click="open"
      >
        <span class="assistant-launcher__face"><AppIcon name="sparkle" :size="25" /><i
          v-if="chatBusy || unread"
          class="assistant-launcher__status"
          :class="{ 'is-busy': chatBusy }"
        /></span>
        <span v-if="!introduced && !idle" class="assistant-launcher__hint">方舟 AI</span>
        <span v-if="unread && !idle" class="assistant-launcher__hint">有新进展</span>
      </button>
      <section
        v-show="navigation.assistantOpen"
        id="assistant-window"
        ref="panel"
        class="assistant-window"
        :class="{ 'is-fullscreen': fullscreen, 'is-dragging': !!drag, 'is-compact': !floating }"
        :style="windowStyle"
        role="dialog"
        tabindex="-1"
        aria-label="方舟 AI"
        :aria-modal="fullscreen || undefined"
        @keydown="panelKeys"
      >
        <header class="assistant-window__bar">
          <button
            v-if="!floating"
            class="assistant-control"
            aria-label="返回工作区"
            @click="closeAssistant"
          ><AppIcon name="left" :size="20" /></button>
          <div
            class="assistant-window__title"
            :class="{ 'is-movable': floating && !expanded }"
            :tabindex="floating && !expanded ? 0 : -1"
            :role="floating && !expanded ? 'button' : undefined"
            :aria-label="floating && !expanded ? '移动方舟 AI 窗口，使用方向键调整位置' : '方舟 AI'"
            @pointerdown="startDrag($event, 'move')"
            @pointermove="moveDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @lostpointercapture="endDrag"
            @keydown="adjustWithKeys($event, 'move')"
          ><span class="assistant-brand" aria-hidden="true"><i /><i /><i /><i /></span><strong>方舟 AI</strong><span class="assistant-window__state">{{ !online ? '当前离线' : chatBusy ? '正在处理' : '随时在这里' }}</span></div>
          <button
            v-if="floating"
            class="assistant-control"
            :aria-label="expanded ? '还原 AI 窗口' : '最大化 AI 窗口'"
            :title="expanded ? '还原' : '最大化'"
            @click="expanded = !expanded"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            ><path :d="expanded ? 'M8 8h12v12H8z M4 16V4h12' : 'M4 4h16v16H4z'" /></svg>
          </button>
          <button
            v-if="floating"
            class="assistant-control"
            aria-label="收起 AI"
            title="收起 AI，对话和任务继续保留"
            @click="closeAssistant"
          ><svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          ><path d="M5 12h14" /></svg></button>
        </header>
        <div class="assistant-window__content">
          <ChatPage
            v-if="identity.user"
            :key="identity.user.id"
            :active="navigation.assistantOpen"
          />
          <div v-else class="assistant-welcome">
            <span class="assistant-welcome__symbol"><AppIcon name="sparkle" :size="32" /></span>
            <p class="assistant-welcome__eyebrow">T方舟 · 你的日常助手</p>
            <h1>从一句话开始</h1>
            <p>聊想法、排日程、整理记录。<br>登录后，让方舟帮你一起完成。</p>
            <button class="button button-primary" @click="showWechatLogin">微信登录</button>
            <span>桌面上的本地工具可以直接使用</span>
          </div>
        </div>
        <button
          v-if="floating && !expanded"
          class="assistant-window__resize"
          aria-label="调整 AI 窗口大小，使用方向键调整"
          title="拖动调整大小"
          @pointerdown="startDrag($event, 'resize')"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @lostpointercapture="endDrag"
          @keydown="adjustWithKeys($event, 'resize')"
        ><svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        ><path d="M4 12l8-8 M8 12l4-4" /></svg></button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.assistant-layer {
  position: fixed;
  z-index: 30;
  pointer-events: none;
  overflow: hidden;
}
.assistant-launcher {
  position: absolute;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition:
    left 180ms ease,
    top 180ms ease;
}
.assistant-launcher__face {
  display: grid;
  place-items: center;
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: #fff;
  background: #137b72;
  border: 1px solid #ffffff70;
  box-shadow:
    0 5px 24px #073f3b38,
    inset 0 1px 0 #ffffff26;
  transition:
    transform 220ms ease,
    opacity 220ms ease;
}
.assistant-launcher.is-idle .assistant-launcher__face {
  opacity: 0.72;
}
.assistant-launcher.is-tucked .assistant-launcher__face {
  transform: translateX(28px);
}
.assistant-launcher.is-tucked.is-left .assistant-launcher__face {
  transform: translateX(-28px);
}
.assistant-launcher:hover .assistant-launcher__face,
.assistant-launcher:focus-visible .assistant-launcher__face {
  transform: none;
  opacity: 1;
}
.assistant-launcher.is-dragging {
  transition: none;
  cursor: grabbing;
}
.assistant-launcher__hint {
  position: absolute;
  right: 66px;
  top: 13px;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 8px;
  background: #fff;
  color: #24483d;
  box-shadow: 0 3px 16px #173b3a1a;
  font-size: 12px;
}
.assistant-launcher.is-left .assistant-launcher__hint {
  left: 66px;
  right: auto;
}
.assistant-launcher__status {
  position: absolute;
  right: 3px;
  top: 2px;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #e7ac48;
}
.assistant-launcher__status.is-busy {
  background: #b7e2ca;
  animation: assistant-pulse 1.5s ease-in-out infinite;
}
.assistant-window {
  position: absolute;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid #d9e6e0;
  border-radius: 20px;
  background: #f9fbfa;
  box-shadow:
    0 24px 80px #173b3a30,
    0 3px 14px #173b3a14;
  overflow: hidden;
  container-type: inline-size;
}
.assistant-window.is-fullscreen {
  inset: 0;
  border: 0;
  border-radius: 0;
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-left: env(safe-area-inset-left);
}
.assistant-window__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: 54px;
  padding: 7px 10px 7px 16px;
  border-bottom: 1px solid #e0e9e4;
  background: #f1f6f3;
}
.assistant-window__title {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 9px;
  min-height: 38px;
  border-radius: 7px;
  color: #24483d;
}
.assistant-window__title strong {
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}
.assistant-window__title.is-movable {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.assistant-window.is-dragging .assistant-window__title.is-movable {
  cursor: grabbing;
}
.assistant-window__state {
  color: #73877d;
  font-size: 11px;
  white-space: nowrap;
}
.assistant-brand {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 22px;
  height: 22px;
  flex: none;
  transform: rotate(-5deg);
}
.assistant-brand i {
  border-radius: 3px;
  background: #137b72;
}
.assistant-brand i:first-child {
  background: #c5dfd4;
}
.assistant-brand i:nth-child(2) {
  background: #83b3a4;
}
.assistant-brand i:last-child {
  background: #4b9784;
}
.assistant-control {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #526e63;
  flex: none;
}
.assistant-control:hover {
  background: #e3ede6;
}
.assistant-window__content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.assistant-window__content :deep(.chat-page) {
  width: 100%;
  max-width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 20px 16px;
}
.assistant-window__content :deep(.chat-toolbar) {
  padding: 10px 0;
  gap: 8px;
  min-height: 52px;
}
.assistant-window__content :deep(.welcome-timeline) {
  justify-content: center;
  padding: 24px 0;
}
.assistant-window__content :deep(.welcome-content) {
  text-align: left;
}
.assistant-window__content :deep(.welcome-symbol) {
  display: grid;
  width: 32px;
  height: 32px;
  gap: 3px;
  margin: 0 0 18px;
}
.assistant-window__content :deep(.welcome-content h1) {
  font-size: 28px;
  margin-bottom: 12px;
}
.assistant-window__content :deep(.welcome-prompts) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.assistant-window__content :deep(.welcome-prompts button) {
  border: 1px solid #dfe8e3;
  border-radius: 9px;
  padding: 9px 11px;
  background: #fff;
  color: #567368;
  font-size: 12px;
}
.assistant-window__content :deep(.composer-area) {
  flex: none;
  margin: 0;
}
.assistant-window__content :deep(.conversation-messages) {
  width: 100%;
}
.assistant-window.is-fullscreen .assistant-window__content :deep(.chat-page) {
  max-width: 960px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
.assistant-window.is-fullscreen .assistant-window__content {
  display: flex;
  justify-content: center;
}
.assistant-window__resize {
  position: absolute;
  bottom: 0;
  right: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px 0 0;
  padding: 0;
  background: transparent;
  color: #8ba397;
  cursor: nwse-resize;
  touch-action: none;
}
.assistant-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 16px;
  height: 100%;
  width: 100%;
  padding: 24px;
  overflow-y: auto;
}
.assistant-welcome__symbol {
  color: #137b72;
}
.assistant-welcome p {
  color: #73877d;
  line-height: 1.8;
  font-size: 13px;
  margin: 0;
}
.assistant-welcome h1 {
  margin: 0;
  font-size: 28px;
  color: #24483d;
}
.assistant-welcome > span:last-child {
  color: #8a9b92;
  font-size: 11px;
}
.assistant-welcome .button {
  min-height: 44px;
  padding-inline: 30px;
}
@container (max-width: 540px) {
  .assistant-window__content :deep(.toolbar-text) {
    display: none;
  }
  .assistant-window__content :deep(.chat-toolbar-actions) {
    gap: 3px;
  }
  .assistant-window__content :deep(.new-conversation) {
    padding: 7px 5px;
  }
}
@container (max-width: 400px) {
  .assistant-window__content :deep(.chat-page) {
    padding-right: 14px;
    padding-left: 14px;
  }
  .assistant-window__content :deep(.welcome-prompts) {
    display: none;
  }
  .assistant-window__state {
    display: none;
  }
}
@media (hover: hover) {
  .assistant-launcher:hover .assistant-launcher__face {
    transform: none;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-launcher,
  .assistant-launcher__face {
    transition: none;
  }
  .assistant-launcher__status.is-busy {
    animation: none;
  }
}
@keyframes assistant-pulse {
  50% {
    opacity: 0.4;
  }
}
</style>
