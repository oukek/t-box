<script setup lang="ts">
defineProps<{
  title: string
  hint: string
  tone?: 'sky' | 'sage' | 'gold'
  disabled?: boolean
}>()
defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="baby-card"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span
      class="quick-symbol"
      :class="tone"
      aria-hidden="true"
    ><slot /></span>
    <strong>{{ title }}</strong>
    <small>{{ hint }}</small>
  </button>
</template>
