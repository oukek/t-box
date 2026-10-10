<script setup lang="ts">
import { handleDialogCancel } from "./dialogCancel";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ open: boolean; title: string; busy?: boolean }>(),
  emit = defineEmits<{ close: [] }>(),
  panel = ref<HTMLDialogElement>();
let previous: HTMLElement | null = null,
  previousOverflow: string | undefined;
function restore() {
  if (previousOverflow !== undefined) {
    document.body.style.overflow = previousOverflow;
    previousOverflow = undefined;
  }
  if (previous?.isConnected) previous.focus();
  previous = null;
}
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open) {
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      panel.value?.showModal();
    } else panel.value?.close();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  panel.value?.close();
  restore();
});
</script>
<template>
  <dialog
    ref="panel"
    class="side-panel"
    :aria-label="title"
    @cancel="
      (event) => handleDialogCancel(event, panel, busy, () => emit('close'))
    "
    @close="restore"
    @click="(event) => event.target === panel && !busy && emit('close')"
  >
    <header class="side-panel-heading">
      <h2>{{ title }}</h2>
      <button
        class="icon-button"
        aria-label="关闭侧栏"
        :disabled="busy"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="19" />
      </button>
    </header>
    <div class="side-panel-body"><slot /></div>
    <footer v-if="$slots.footer" class="side-panel-footer">
      <slot name="footer" />
    </footer>
  </dialog>
</template>
<style scoped>
.side-panel {
  position: fixed;
  inset: 0 auto 0 0;
  margin: 0;
  width: 324px;
  max-width: calc(100vw - 44px);
  height: 100dvh;
  max-height: 100dvh;
  border: 0;
  border-right: 1px solid #e6edee;
  border-radius: 0;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  color: var(--ink);
  background: #fbfcfc;
  box-shadow: 12px 0 45px #2034470d;
}
.side-panel[open] {
  display: flex;
  flex-direction: column;
  animation: panel-enter 0.18s ease-out;
}
.side-panel::backdrop {
  background: #20344726;
}
.side-panel-heading {
  min-height: 70px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid #edf1f2;
  flex-shrink: 0;
}
.side-panel-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.side-panel-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 12px;
  overscroll-behavior: contain;
}
.side-panel-footer {
  padding: 16px 20px;
  border-top: 1px solid #edf1f2;
  flex-shrink: 0;
}
@keyframes panel-enter {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .side-panel[open] {
    animation: none;
  }
}
</style>
