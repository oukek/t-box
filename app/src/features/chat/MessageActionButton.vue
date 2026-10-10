<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'

defineProps<{
  icon: string
  label: string
  title?: string
  disabled?: boolean
}>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="message-action-button"
    type="button"
    :aria-label="label"
    :title="title || label"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <AppIcon :name="icon" :size="15" />
  </button>
</template>

<style scoped>
.message-action-button {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  padding: 0;
  background: transparent;
  color: #89978f;
  cursor: pointer;
}
.message-action-button:hover:not(:disabled) {
  color: var(--ink);
  background: #edf2ee;
}
.message-action-button:focus-visible {
  outline: 2px solid #739d8c;
  outline-offset: 2px;
}
.message-action-button:disabled {
  opacity: 0.35;
  cursor: default;
}
@media (pointer: coarse) {
  .message-action-button {
    flex-basis: 32px;
    width: 32px;
    height: 32px;
  }
}
</style>
