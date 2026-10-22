<script setup lang="ts">
import { handleDialogCancel } from './dialogCancel'
import { useDialog } from './useDialog'

const props = defineProps<{ open: boolean, title: string, busy?: boolean }>()
const emit = defineEmits<{ close: [], opened: [] }>()
const { dialog, closed } = useDialog(() => props.open, { opened: () => emit('opened') })
</script>

<template>
  <dialog
    ref="dialog"
    class="dialog book-dialog"
    :aria-label="title"
    @cancel="
      (event) => handleDialogCancel(event, dialog, busy, () => emit('close'))
    "
    @close="closed"
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
      <footer v-if="$slots.footer" class="dialog-footer">
        <slot name="footer" />
      </footer>
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
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
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
