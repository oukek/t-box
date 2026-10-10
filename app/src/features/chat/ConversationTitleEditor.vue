<script setup lang="ts">
import { ref, watch, nextTick, useId } from "vue";
import type { ResourceRef } from "@t-box/shared";
import { Modal } from "@t-box/ui-kit";
import { request } from "../../core/network";
import { authorizeResources } from "../../applications/registry";
import { setConversationTitle } from "./chatStore";
import { refreshConversationHistory } from "./conversationStore";
const props = defineProps<{
  open: boolean;
  conversationId: string;
  title: string;
  resources?: readonly ResourceRef[];
}>();
const emit = defineEmits<{ close: [] }>();
const inputId = `conversation-title-${useId()}`;
const value = ref(""),
  busy = ref(false),
  error = ref(""),
  input = ref<HTMLInputElement>();
watch(
  () => props.open,
  (open) => {
    if (open) {
      value.value = props.title;
      error.value = "";
    }
  },
  { immediate: true },
);
async function focus() {
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
async function save() {
  if (busy.value || !value.value.trim()) return;
  busy.value = true;
  error.value = "";
  const id = props.conversationId;
  try {
    if (!(await authorizeResources(props.resources || [], "修改会话标题")))
      return;
    const result = await request<{ data: { title: string } }>(
      `/conversations/${id}`,
      { method: "PATCH", body: JSON.stringify({ title: value.value.trim() }) },
    );
    setConversationTitle(id, result.data.title);
    await refreshConversationHistory();
    emit("close");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "修改失败";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Modal
    :open="open"
    title="修改会话标题"
    :busy="busy"
    @close="emit('close')"
    @opened="focus"
  >
    <form class="title-form" @submit.prevent="save">
      <label :for="inputId">标题</label>
      <input
        :id="inputId"
        ref="input"
        v-model="value"
        maxlength="60"
        :disabled="busy"
        required
        autocomplete="off"
      />
      <p class="title-help">手动修改后，将保留你设置的标题。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button
          type="button"
          class="button button-secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          取消</button
        ><button
          class="button button-primary"
          :disabled="busy || !value.trim()"
        >
          {{ busy ? "保存中…" : "保存" }}
        </button>
      </div>
    </form>
  </Modal>
</template>
<style scoped>
.title-form {
  display: grid;
  gap: 10px;
  padding-top: 12px;
}
.title-form label {
  color: #647d72;
  font-size: 12px;
}
.title-form input {
  width: 100%;
  min-width: 0;
  border: 1px solid #dce6df;
  border-radius: 9px;
  padding: 11px 12px;
  background: #fbfcfb;
  color: var(--ink);
  font-size: 14px;
  outline: none;
}
.title-form input:focus {
  border-color: #86ac9b;
}
.title-help {
  font-size: 11px;
  color: #94a298;
  margin: 0 0 10px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 8px;
}
</style>
