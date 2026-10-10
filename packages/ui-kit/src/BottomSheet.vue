<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { handleDialogCancel } from './dialogCancel'
import { lockDocumentScroll } from './sheetScroll'

const props = defineProps<{
  open: boolean
  title: string
  busy?: boolean
  fullHeight?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ close: [], opened: [] }>()
const dialog = ref<HTMLDialogElement>()
const viewportHeight = ref<number>()
const bottomInset = ref(0)
function updateViewport() {
  const viewport = window.visualViewport
  if (!props.fullHeight || (viewport && viewport.scale !== 1)) {
    return
  }
  viewportHeight.value = viewport?.height ?? window.innerHeight
  bottomInset.value = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0
}
function stopViewport() {
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
}
let previous: HTMLElement | null = null
let release: (() => void) | undefined
function restore() {
  stopViewport()
  release?.()
  release = undefined
  const target = previous
  previous = null
  if (target?.isConnected) {
    target.focus()
  }
}
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open && props.open && dialog.value && !dialog.value.open) {
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      release = lockDocumentScroll()
      if (props.fullHeight) {
        updateViewport()
        window.visualViewport?.addEventListener('resize', updateViewport)
        window.visualViewport?.addEventListener('scroll', updateViewport)
        window.addEventListener('resize', updateViewport)
      }
      dialog.value.showModal()
      emit('opened')
    } else if (!open) {
      dialog.value?.close()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  dialog.value?.close()
  restore()
})
</script>

<template>
  <!-- Keep the dialog outside field labels so backdrop clicks cannot activate their trigger. -->
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="sheet-dialog"
      :class="{ 'sheet-full-height': fullHeight, 'sheet-compact': compact }"
      :style="
        fullHeight
          ? {
            '--sheet-viewport-height': viewportHeight
              ? `${viewportHeight}px`
              : undefined,
            '--sheet-bottom-inset': `${bottomInset}px`,
          }
          : undefined
      "
      :aria-label="title"
      @cancel="
        (event) => handleDialogCancel(event, dialog, busy, () => emit('close'))
      "
      @close="restore"
      @click.stop="(event) => event.target === dialog && !busy && emit('close')"
    >
      <div class="sheet-handle" aria-hidden="true" />
      <header class="sheet-heading">
        <h2>{{ title }}</h2>
        <button
          class="icon-button"
          type="button"
          aria-label="关闭选择面板"
          :disabled="busy"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="20" />
        </button>
      </header>
      <div class="sheet-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="sheet-footer">
        <slot name="footer" />
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.sheet-dialog {
  position: fixed;
  inset: auto 0 0;
  margin: 0 auto;
  width: min(100%, 560px);
  max-width: 100%;
  max-height: calc(100dvh - max(24px, env(safe-area-inset-top)));
  padding: 0 0 env(safe-area-inset-bottom);
  border: 0;
  border-radius: 22px 22px 0 0;
  background: #fff;
  color: var(--ink);
  box-shadow: 0 -12px 50px #20344712;
  overflow: hidden;
}
.sheet-dialog[open] {
  display: flex;
  flex-direction: column;
  animation: sheet-enter 0.2s ease-out;
}
.sheet-dialog::backdrop {
  background: #20344742;
}
.sheet-handle {
  width: 34px;
  height: 4px;
  border-radius: 3px;
  background: #dae2e4;
  margin: 10px auto 0;
  flex-shrink: 0;
}
.sheet-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 22px 12px;
  flex-shrink: 0;
}
.sheet-heading h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.sheet-body {
  padding: 4px 22px 22px;
  overflow: auto;
  overscroll-behavior: contain;
  min-height: 0;
}
.sheet-footer {
  padding: 15px 22px 18px;
  border-top: 1px solid #edf1f2;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}
.sheet-footer :deep(.button) {
  min-height: 42px;
}
.sheet-footer :deep(.button-primary) {
  flex: 1;
}
.sheet-full-height {
  bottom: var(--sheet-bottom-inset, 0px);
  height: 95vh;
  height: calc(var(--sheet-viewport-height, 100dvh) * 0.95);
  max-height: calc(var(--sheet-viewport-height, 100dvh) - env(safe-area-inset-top));
}
.sheet-full-height .sheet-body {
  flex: 1;
}
.sheet-compact {
  border-radius: 16px 16px 0 0;
}
.sheet-compact .sheet-heading {
  padding: 8px 16px;
  gap: 8px;
}
.sheet-compact .sheet-heading h2 {
  font-size: 15px;
}
.sheet-compact .sheet-body {
  padding: 4px 16px 16px;
}
.sheet-compact .sheet-footer {
  padding: 10px 16px 12px;
  gap: 8px;
}
.sheet-compact :deep(.form-field) {
  margin-top: 14px;
  font-size: 12px;
}
.sheet-compact :deep(.field-label) {
  margin-bottom: 6px;
  font-size: 12px;
}
.sheet-compact :deep(.form-field > input) {
  min-height: 42px;
  padding: 8px 10px;
  font-size: 14px;
}
.sheet-compact :deep(.amount-field) {
  margin: 18px 0;
}
.sheet-compact :deep(.amount-input-wrap input) {
  font-size: 28px;
}
.sheet-compact :deep(.amount-input-wrap > span) {
  font-size: 19px;
}
.sheet-compact :deep(.category-field) {
  margin-bottom: 14px;
}
.sheet-compact :deep(.form-type-control label) {
  padding: 8px;
}
.sheet-compact :deep(.category-add-toggle) {
  font-size: 12px;
  margin-top: 6px;
}
.sheet-compact :deep(.form-error) {
  margin-top: 12px;
}
@media (max-width: 760px) {
  /* Avoid automatic input zoom on iOS while keeping labels and spacing compact. */
  .sheet-compact :deep(.form-field > input) {
    font-size: 16px;
  }
}
@keyframes sheet-enter {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sheet-dialog[open] {
    animation: none;
  }
}
</style>
