<script setup lang="ts">
withDefaults(defineProps<{ type?: 'button' | 'submit' | 'reset' }>(), { type: 'button' })
</script>

<template>
  <button :type="type" class="admin-button"><slot /></button>
</template>
