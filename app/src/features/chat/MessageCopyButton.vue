<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { copyText } from "../../core/clipboard";
import MessageActionButton from "./MessageActionButton.vue";
const props = defineProps<{
  text: string;
  label: string;
  disabled?: boolean;
  feedbackAlign?: "start" | "end";
}>();
const feedback = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  try {
    await copyText(props.text);
    feedback.value = "已复制";
  } catch {
    feedback.value = "复制失败，请手动选择复制";
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    feedback.value = "";
  }, 2200);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>
<template>
  <div class="message-copy-control">
    <MessageActionButton
      :icon="feedback === '已复制' ? 'check' : 'copy'"
      :label="label"
      :title="feedback || label"
      :disabled="disabled || !text"
      @click="copy"
    />
    <span
      v-if="feedback"
      role="status"
      :class="
        feedback === '已复制'
          ? 'sr-only'
          : ['copy-error', { 'align-end': feedbackAlign === 'end' }]
      "
      >{{ feedback }}</span
    >
  </div>
</template>
<style scoped>
.message-copy-control {
  position: relative;
  flex-shrink: 0;
}
.copy-error {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  width: 160px;
  max-width: calc(100vw - 40px);
  padding: 5px 8px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 2px 12px #20344712;
  color: #976c4f;
  font-size: 11px;
}
.copy-error.align-end {
  left: auto;
  right: 0;
}
</style>
