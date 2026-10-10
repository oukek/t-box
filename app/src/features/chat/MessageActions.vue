<script setup lang="ts">
import { computed } from 'vue'
import MessageActionButton from './MessageActionButton.vue'
import MessageCopyButton from './MessageCopyButton.vue'
import MessageFooter from './MessageFooter.vue'

const props = defineProps<{
  text: string
  createdAt: string
  disabled: boolean
  canEdit: boolean
}>()
const emit = defineEmits<{ edit: [], delete: [] }>()
const time = computed(() =>
  new Date(props.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
)
const dateTime = computed(() =>
  new Date(props.createdAt).toLocaleString('zh-CN', { hour12: false }),
)
</script>

<template>
  <MessageFooter align="end">
    <time :datetime="createdAt" :title="dateTime">{{ time }}</time>
    <div class="message-actions" aria-label="消息操作">
      <MessageCopyButton
        :text="text"
        label="复制消息"
        feedback-align="end"
      />
      <MessageActionButton
        icon="edit"
        label="修改并重新发送这条消息"
        title="修改并重新发送"
        :disabled="disabled || !canEdit"
        @click="emit('edit')"
      />
      <MessageActionButton
        icon="trash"
        label="删除这个问题和回答"
        title="删除问题和回答"
        :disabled="disabled"
        @click="emit('delete')"
      />
    </div>
  </MessageFooter>
</template>

<style scoped>
.message-actions {
  display: flex;
  align-items: center;
  gap: 0;
}
time {
  white-space: nowrap;
}
</style>
