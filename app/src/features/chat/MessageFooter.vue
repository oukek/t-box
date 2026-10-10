<script setup lang="ts">
defineProps<{ align?: 'start' | 'end' }>()
</script>

<template>
  <div class="message-footer" :class="{ 'align-end': align === 'end' }">
    <slot />
  </div>
</template>

<style scoped>
.message-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 7px;
  margin-top: 6px;
  min-width: 0;
  max-width: 100%;
  color: #89978f;
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.align-end {
  justify-content: flex-end;
  align-self: flex-end;
}
</style>
