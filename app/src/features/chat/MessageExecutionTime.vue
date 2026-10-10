<script setup lang="ts">
import type { MessageExecution } from '@t-box/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { elapsedExecution, formatExecutionTime } from './executionTime'

const props = defineProps<{
  execution: Readonly<MessageExecution>
  active: boolean
}>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
watch(
  () => props.active,
  (active) => {
    clearInterval(timer)
    now.value = Date.now()
    if (active) {
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(timer))
const duration = computed(() =>
  formatExecutionTime(
    elapsedExecution(props.execution, props.active, now.value),
  ),
)
</script>

<template>
  <div class="message-execution-time">
    {{ active ? "已处理" : "用时" }} {{ duration }}
  </div>
</template>

<style scoped>
.message-execution-time {
  color: #87998f;
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
</style>
