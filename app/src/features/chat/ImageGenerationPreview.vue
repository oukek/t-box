<script setup lang="ts">
import type { ToolOutputPreview, ToolStatus } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import { computed, onMounted } from 'vue'

const props = defineProps<{
  preview: Readonly<ToolOutputPreview>
  status: ToolStatus
  active: boolean
}>()
const emit = defineEmits<{ rendered: [] }>()
const generating = computed(() => props.active && props.status === 'running')
const ratio = computed(() =>
  props.preview.width > 0 && props.preview.height > 0
    ? `${props.preview.width} / ${props.preview.height}`
    : '1 / 1',
)
onMounted(() => emit('rendered'))
</script>

<template>
  <div
    class="image-generation-preview"
    :class="{ generating }"
    :style="{ aspectRatio: ratio }"
    role="status"
    :aria-busy="generating"
    :aria-label="generating ? preview.label : '图片处理已中断'"
  >
    <div class="image-wash" aria-hidden="true" />
    <div class="image-frame" aria-hidden="true">
      <AppIcon name="image" :size="34" />
    </div>
    <div class="image-generation-caption">
      <span
        v-if="generating"
        class="preview-dots"
        aria-hidden="true"
      ><i /><i /><i /></span>
      <AppIcon
        v-else
        name="warning"
        :size="14"
      />
      <span>{{ generating ? `${preview.label}…` : "图片处理已中断" }}</span>
    </div>
  </div>
</template>

<style scoped>
.image-generation-preview {
  position: relative;
  isolation: isolate;
  width: min(100%, 260px);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  border: 1px solid #dfebe5;
  border-radius: 16px;
  background: #f0f5f2;
  color: #88a69a;
}
.image-wash {
  position: absolute;
  inset: -55%;
  z-index: -1;
  opacity: 0.45;
  background: conic-gradient(from 20deg, #edf4ee, #cce7da, #e4ede1, #dce9f2, #f1f5ec, #cce7da, #edf4ee);
  filter: blur(26px);
}
.generating .image-wash {
  animation: image-wash 8s linear infinite;
  opacity: 0.85;
}
.image-frame {
  width: 72px;
  height: 72px;
  border: 1px solid #c4d9ce;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: #ffffff4d;
}
.generating .image-frame {
  animation: image-breathe 3s ease-in-out infinite;
}
.image-generation-caption {
  position: absolute;
  inset: auto 12px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #668c7b;
  font-size: 12px;
  line-height: 1.8;
}
.preview-dots {
  display: flex;
  gap: 3px;
  align-items: center;
}
.preview-dots i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: image-dot 1.4s ease-in-out infinite;
}
.preview-dots i:nth-child(2) {
  animation-delay: 0.18s;
}
.preview-dots i:nth-child(3) {
  animation-delay: 0.36s;
}
@keyframes image-wash {
  to {
    transform: rotate(360deg);
  }
}
@keyframes image-breathe {
  50% {
    opacity: 0.5;
    transform: scale(0.96);
  }
}
@keyframes image-dot {
  50% {
    opacity: 0.25;
    transform: translateY(-2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .generating .image-wash,
  .generating .image-frame,
  .preview-dots i {
    animation: none;
  }
}
</style>
