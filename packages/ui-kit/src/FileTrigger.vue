<script setup lang="ts">
import { ref } from 'vue'

const input = ref<HTMLInputElement>()
defineExpose({ click: () => input.value?.click(), reset: () => {
  if (input.value) {
    input.value.value = ''
  }
} })
</script>

<template>
  <input
    ref="input"
    type="file"
    class="ark-file-trigger"
  >
</template>

<style scoped>
.ark-file-trigger {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
