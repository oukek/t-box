<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { lockScroll } from '../core/overlay'
import AdminButton from './AdminButton.vue'
import AdminIcon from './AdminIcon.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    busy?: boolean
    compact?: boolean
  }>(),
  { busy: false },
)
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
const descriptionId = useId()
let release: (() => void) | undefined
let opener: HTMLElement | null = null
function requestClose() {
  if (!props.busy) {
    emit('close')
  }
}
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value) {
    return
  }
  const bounds = dialog.value!.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  ) {
    requestClose()
  }
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      await nextTick()
      if (!props.open || !dialog.value) {
        return
      }
      if (!dialog.value.open) {
        dialog.value.showModal()
        release = lockScroll()
        const initial =
          dialog.value.querySelector<HTMLElement>(
            '.dialog-body input:not([aria-hidden]):not(:disabled), .dialog-body textarea:not(:disabled), .dialog-body [role="combobox"]:not(:disabled)',
          ) || dialog.value.querySelector<HTMLElement>('.dialog-footer button') || dialog.value.querySelector<HTMLElement>('h2')
        initial?.focus({ preventScroll: true })
        if (initial instanceof HTMLTextAreaElement) {
          initial.setSelectionRange(0, 0)
          initial.scrollTop = 0
        }
      }
    } else {
      dialog.value?.close()
      release?.()
      release = undefined
      if (opener?.isConnected) {
        opener.focus()
      }
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  dialog.value?.close()
  release?.()
  if (opener?.isConnected) {
    opener.focus()
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="admin-dialog"
    :class="{ compact }"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    @cancel.self.prevent="requestClose"
    @click="backdrop"
  >
    <header class="dialog-heading">
      <div>
        <h2 :id="titleId" tabindex="-1">
          {{ title }}
        </h2>
        <p v-if="description" :id="descriptionId">
          {{ description }}
        </p>
      </div>
      <AdminButton
        type="button"
        class="icon-button"
        aria-label="关闭弹窗"
        :disabled="busy"
        @click="requestClose"
      >
        <AdminIcon name="close" />
      </AdminButton>
    </header>
    <div v-if="open" class="dialog-body dialog-form">
      <slot />
    </div>
    <footer v-if="open && $slots.footer" class="dialog-footer">
      <slot name="footer" />
    </footer>
  </dialog>
</template>
