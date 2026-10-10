<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { MarkdownPreview } from "../../components/markdown-preview";
const props = defineProps<{ text: string; streaming?: boolean }>();
const emit = defineEmits<{ rendered: [] }>();
const shown = ref(props.text);
let frame = 0,
  last = 0,
  typing = false;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
}
function tick(time: number) {
  if (time - last >= 24) {
    last = time;
    const chars = [...props.text],
      current = [...shown.value].length;
    const count = Math.max(1, Math.ceil((chars.length - current) / 8));
    shown.value = chars.slice(0, current + count).join("");
  }
  if (shown.value !== props.text) frame = requestAnimationFrame(tick);
  else {
    frame = 0;
    typing = false;
  }
}
watch(
  () => props.text,
  (value, old) => {
    if (
      (!props.streaming && !typing) ||
      reduced.matches ||
      document.hidden ||
      !value.startsWith(old)
    ) {
      stop();
      shown.value = value;
      typing = false;
      return;
    }
    typing = true;
    if (!frame) frame = requestAnimationFrame(tick);
  },
);
onBeforeUnmount(stop);
</script>
<template>
  <div class="stream-text">
    <MarkdownPreview :text="shown" @rendered="emit('rendered')" /><span
      v-if="streaming"
      class="stream-caret"
      aria-hidden="true"
    ></span>
  </div>
</template>
<style scoped>
.stream-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 3px;
  vertical-align: -2px;
  background: #599285;
  animation: caret 1s ease-in-out infinite;
}
@keyframes caret {
  50% {
    opacity: 0.2;
  }
}
@media (prefers-reduced-motion: reduce) {
  .stream-caret {
    animation: none;
  }
}
</style>
