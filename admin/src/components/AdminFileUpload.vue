<script setup lang="ts">
import { ref } from 'vue'
import AdminButton from './AdminButton.vue'

defineOptions({ inheritAttrs: false })
defineProps<{
  accept?: string
  multiple?: boolean
  directory?: boolean
  disabled?: boolean
  label: string
}>()
const emit = defineEmits<{ change: [event: Event] }>()
const input = ref<HTMLInputElement>()

function choose() {
  if (input.value && !input.value.matches(':disabled')) {
    // A repeated selection of the same file/directory must still emit change.
    input.value.value = ''
    input.value.click()
  }
}
</script>

<template>
  <span
    class="admin-file-upload"
    :class="$attrs.class"
    :style="$attrs.style"
  >
    <AdminButton
      :aria-label="label"
      :disabled="disabled"
      @click="choose"
    ><slot>{{ label }}</slot></AdminButton>
    <input
      ref="input"
      class="sr-only"
      type="file"
      tabindex="-1"
      aria-hidden="true"
      :accept="accept"
      :multiple="multiple || directory"
      :webkitdirectory="directory ? '' : undefined"
      :disabled="disabled"
      @change="emit('change', $event)"
    >
  </span>
</template>
