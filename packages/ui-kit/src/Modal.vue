<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { handleDialogCancel } from './dialogCancel'
import { lockDocumentScroll } from './sheetScroll'

const props = defineProps<{ open: boolean, title: string, busy?: boolean }>()
const emit = defineEmits<{ close: [], opened: [] }>()
const dialog = ref<HTMLDialogElement>()
let previous: HTMLElement | null = null
let release: (() => void) | undefined
function restore() {
  release?.()
  release = undefined
  if (previous?.isConnected) {
    previous.focus()
  }
  previous = null
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
      dialog.value.showModal()
      emit('opened')
    } else {
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
  <dialog
    ref="dialog"
    class="dialog book-dialog"
    :aria-label="title"
    @cancel="
      (event) => handleDialogCancel(event, dialog, busy, () => emit('close'))
    "
    @close="restore"
    @click="(event) => event.target === dialog && !busy && emit('close')"
  >
    <div class="dialog-content">
      <header class="dialog-heading">
        <h2>{{ title }}</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭窗口"
          :disabled="busy"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  border: 0;
  padding: 0;
  border-radius: 12px;
  width: min(520px, calc(100% - 32px));
  max-height: 85dvh;
  color: var(--ink, #203447);
  box-shadow: 0 20px 90px #112a3840;
}
.dialog::backdrop {
  background: #122a3e66;
  backdrop-filter: blur(3px);
}
.dialog-content {
  padding: 24px;
}
.dialog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 22px;
}
.dialog-heading h2 {
  font-size: 17px;
  margin: 0;
  font-weight: 620;
}
.dialog-heading .icon-button {
  align-self: flex-start;
  margin: -4px -6px 0 0;
}
@media (max-width: 560px) {
  .dialog-content {
    padding: 20px;
  }
  .dialog-heading {
    margin-bottom: 18px;
  }
}
</style>
