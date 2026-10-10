<script setup lang="ts">
import { ref, watch } from "vue";
import { Modal } from "@t-box/ui-kit";
import { deleteMessage } from "./chatStore";
import { refreshConversationHistory } from "./conversationStore";
const props = defineProps<{
  open: boolean;
  messageId: string;
  preview: string;
}>();
const emit = defineEmits<{ close: []; deleted: [id: string] }>();
const busy = ref(false),
  error = ref("");
watch(
  () => props.open,
  () => {
    error.value = "";
  },
);
async function remove() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const id = props.messageId;
  try {
    await deleteMessage(id);
    emit("deleted", id);
    emit("close");
    void refreshConversationHistory();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除失败";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Modal
    :open="open"
    title="删除问题和回答？"
    :busy="busy"
    @close="emit('close')"
  >
    <p class="delete-description">
      这个问题和对应的回答会一起删除，其余消息保留。
    </p>
    <p class="delete-preview">{{ preview }}</p>
    <p class="delete-help">已创建的账单、资源和费用记录不会被撤销。</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="delete-actions">
      <button
        type="button"
        class="button button-secondary"
        :disabled="busy"
        @click="emit('close')"
      >
        取消</button
      ><button
        type="button"
        class="button delete-confirm"
        :disabled="busy"
        @click="remove"
      >
        {{ busy ? "删除中…" : "一起删除" }}
      </button>
    </div>
  </Modal>
</template>
<style scoped>
.delete-description {
  font-size: 14px;
  line-height: 1.7;
  margin: 0 0 14px;
}
.delete-preview {
  border-radius: 9px;
  padding: 12px;
  background: #f5f7f5;
  font-size: 13px;
  line-height: 1.7;
  color: #5b6d62;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 120px;
  overflow: auto;
  margin: 0 0 12px;
}
.delete-help {
  font-size: 12px;
  line-height: 1.7;
  color: #8b9690;
}
.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
.delete-confirm {
  background: #bd5252;
  color: white;
  border-color: #bd5252;
}
.delete-confirm:hover {
  background: #ab4646;
}
</style>
