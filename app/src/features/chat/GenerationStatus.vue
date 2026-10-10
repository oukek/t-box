<script setup lang="ts">
import { onMounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{ label?: string, waiting?: boolean }>(),
  { label: '生成中…', waiting: false },
)
const emit = defineEmits<{ rendered: [] }>()
onMounted(() => emit('rendered'))
watch(
  () => [props.label, props.waiting],
  () => emit('rendered'),
  { flush: 'post' },
)
</script>

<template>
  <div
    class="generation-status"
    role="status"
    aria-live="polite"
  >
    <span
      v-if="!waiting"
      class="spinner small"
      aria-hidden="true"
    />
    <span
      v-else
      class="waiting-dot"
      aria-hidden="true"
    />
    <span>{{ waiting ? "等待你处理…" : label }}</span>
  </div>
</template>

<style scoped>
.generation-status {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #7b9087;
  font-size: 12px;
  line-height: 1.8;
  padding: 10px 0 2px;
}
.spinner.small {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-color: #dbe7e1;
  border-top-color: #76998b;
}
.waiting-dot {
  width: 7px;
  height: 7px;
  margin: 0 3px;
  border-radius: 50%;
  background: #ba986a;
  flex-shrink: 0;
}
</style>
