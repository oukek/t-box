<script setup lang="ts">
import { Modal } from '@t-box/ui-kit'
import { onBeforeUnmount, watch } from 'vue'
import { chatState } from './chatStore'
import {
  closeMemoryConfirmation,
  memoryConfirmation,
} from './memoryConfirmation'

watch(
  () => [chatState.activeRun?.id, chatState.connection],
  ([id, connection], previous) => {
    if (
      !id ||
      connection !== 'connected' ||
      (previous?.[0] && previous[0] !== id)
    ) {
      closeMemoryConfirmation()
    }
  },
)
onBeforeUnmount(() => closeMemoryConfirmation())
</script>

<template>
  <Modal
    :open="!!memoryConfirmation.proposal"
    :title="
      memoryConfirmation.proposal?.action === 'forget'
        ? '忘记这项记忆？'
        : '记住这条信息？'
    "
    @close="closeMemoryConfirmation()"
  >
    <div class="memory-proposal">
      <strong>{{ memoryConfirmation.proposal?.label }}</strong>
      <p>{{ memoryConfirmation.proposal?.content }}</p>
    </div>
    <p class="memory-proposal-help">
      {{
        memoryConfirmation.proposal?.action === 'forget'
          ? '删除后不会用于新请求。原来的聊天记录与应用数据会保留。'
          : '确认后可用于之后的对话。你可以在 AI 中心的「记忆」中修改或删除。'
      }}
    </p>
    <template #footer><button
      class="button button-secondary"
      @click="closeMemoryConfirmation()"
    >
      取消</button><button
      class="button button-primary"
      @click="closeMemoryConfirmation(true)"
    >
      {{
        memoryConfirmation.proposal?.action === 'forget' ? '忘记' : '确认记住'
      }}
    </button></template>
  </Modal>
</template>

<style scoped>
.memory-proposal {
  padding: 14px;
  border: 1px solid #dce8e2;
  border-radius: 10px;
  background: #f6f9f7;
  font-size: 13px;
}
.memory-proposal p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  margin: 8px 0 0;
  color: #526a60;
}
.memory-proposal-help {
  font-size: 12px;
  line-height: 1.8;
  color: #7e8d86;
  margin: 16px 0 0;
}
</style>
