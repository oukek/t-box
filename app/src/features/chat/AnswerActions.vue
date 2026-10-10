<script setup lang="ts">
import MessageActionButton from './MessageActionButton.vue'
import MessageCopyButton from './MessageCopyButton.vue'

defineProps<{
  text: string
  retryDisabled: boolean
  copyingDisabled: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="answer-actions" aria-label="回答操作">
    <MessageCopyButton
      :text="text"
      label="复制回答"
      :disabled="copyingDisabled"
    />
    <MessageActionButton
      icon="refresh"
      label="重试回答"
      title="重新生成回答"
      :disabled="retryDisabled"
      @click="emit('retry')"
    />
  </div>
</template>

<style scoped>
.answer-actions {
  display: flex;
  align-items: center;
  gap: 0;
}
</style>
