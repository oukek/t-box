<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import type { Resource } from "@t-box/shared";
import { AppIcon } from "@t-box/ui-kit";
import ResourceImage from "./ResourceImage.vue";
import { downloadResource } from "../features/resources/resourcesApi";
const props = defineProps<{ resource: Resource | null }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const canvas = ref<HTMLDivElement>();
const viewport = reactive({ width: 0, height: 0 });
const natural = ref({ width: 0, height: 0 });
const scale = ref(1),
  downloading = ref(false),
  error = ref("");
let observer: ResizeObserver | undefined;
let disposed = false;
let previous: HTMLElement | null = null,
  previousOverflow: string | undefined;
let drag:
  { id: number; x: number; y: number; left: number; top: number } | undefined;
let pinchDistance = 0;
const fitted = computed(() => {
  if (!natural.value.width || !natural.value.height)
    return { width: 0, height: 0 };
  const ratio = Math.min(
    1,
    Math.max(1, viewport.width - 24) / natural.value.width,
    Math.max(1, viewport.height - 24) / natural.value.height,
  );
  return {
    width: natural.value.width * ratio,
    height: natural.value.height * ratio,
  };
});
const imageStyle = computed(() =>
  fitted.value.width
    ? {
        width: `${fitted.value.width * scale.value}px`,
        height: `${fitted.value.height * scale.value}px`,
      }
    : {},
);
const stageStyle = computed(() => ({
  width: `${Math.max(viewport.width, fitted.value.width * scale.value + 24)}px`,
  height: `${Math.max(viewport.height, fitted.value.height * scale.value + 24)}px`,
}));
function center() {
  if (!canvas.value) return;
  canvas.value.scrollLeft =
    (canvas.value.scrollWidth - canvas.value.clientWidth) / 2;
  canvas.value.scrollTop =
    (canvas.value.scrollHeight - canvas.value.clientHeight) / 2;
}
async function zoom(value: number) {
  if (!natural.value.width) return;
  scale.value = Math.min(5, Math.max(1, value));
  await nextTick();
  center();
}
function restore() {
  observer?.disconnect();
  observer = undefined;
  drag = undefined;
  pinchDistance = 0;
  if (previousOverflow !== undefined) {
    document.body.style.overflow = previousOverflow;
    previousOverflow = undefined;
  }
  if (previous?.isConnected) previous.focus({ preventScroll: true });
  previous = null;
}
watch(
  () => props.resource?.id,
  async (id) => {
    scale.value = 1;
    natural.value = { width: 0, height: 0 };
    error.value = "";
    await nextTick();
    if (disposed || id !== props.resource?.id) return;
    if (!id) {
      dialog.value?.close();
      restore();
      return;
    }
    if (!dialog.value?.open) {
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.value?.showModal();
    }
    observer?.disconnect();
    observer = new ResizeObserver(() => {
      if (!canvas.value) return;
      viewport.width = canvas.value.clientWidth;
      viewport.height = canvas.value.clientHeight;
      void nextTick(center);
    });
    if (canvas.value) observer.observe(canvas.value);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  dialog.value?.close();
  restore();
});
function startDrag(event: PointerEvent) {
  if (
    event.pointerType !== "mouse" ||
    event.button !== 0 ||
    scale.value <= 1 ||
    !canvas.value
  )
    return;
  event.preventDefault();
  canvas.value.setPointerCapture(event.pointerId);
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: canvas.value.scrollLeft,
    top: canvas.value.scrollTop,
  };
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || !canvas.value) return;
  canvas.value.scrollLeft = drag.left - (event.clientX - drag.x);
  canvas.value.scrollTop = drag.top - (event.clientY - drag.y);
}
function endDrag() {
  drag = undefined;
}
const distance = (event: TouchEvent) =>
  Math.hypot(
    event.touches[0]!.clientX - event.touches[1]!.clientX,
    event.touches[0]!.clientY - event.touches[1]!.clientY,
  );
function startPinch(event: TouchEvent) {
  pinchDistance = event.touches.length === 2 ? distance(event) : 0;
}
function movePinch(event: TouchEvent) {
  if (event.touches.length !== 2 || !pinchDistance) return;
  event.preventDefault();
  const next = distance(event);
  if (next > 0) {
    void zoom((scale.value * next) / pinchDistance);
    pinchDistance = next;
  }
}
function wheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  void zoom(scale.value * Math.exp(-event.deltaY * 0.01));
}
async function download() {
  const resource = props.resource;
  if (!resource || downloading.value) return;
  downloading.value = true;
  error.value = "";
  try {
    await downloadResource(resource);
  } catch (cause) {
    if (props.resource?.id === resource.id)
      error.value = cause instanceof Error ? cause.message : "下载失败";
  } finally {
    downloading.value = false;
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="image-viewer"
    aria-label="图片预览"
    @cancel.prevent="emit('close')"
  >
    <template v-if="resource">
      <header class="viewer-toolbar">
        <span class="viewer-name" :title="resource.name">{{
          resource.name
        }}</span>
        <button
          type="button"
          aria-label="下载原图"
          :disabled="downloading"
          @click="download"
        >
          <AppIcon name="arrowDown" :size="20" />
        </button>
        <button
          type="button"
          aria-label="关闭图片预览"
          autofocus
          @click="emit('close')"
        >
          <AppIcon name="close" :size="22" />
        </button>
      </header>
      <div
        ref="canvas"
        class="viewer-canvas"
        :class="{ zoomed: scale > 1 }"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @touchstart="startPinch"
        @touchmove="movePinch"
        @touchend="startPinch"
        @touchcancel="startPinch"
        @wheel="wheel"
      >
        <div
          class="viewer-stage"
          :style="stageStyle"
          @click.self="scale === 1 && emit('close')"
        >
          <ResourceImage
            :key="resource.id"
            class="viewer-image"
            :resource="resource"
            :style="imageStyle"
            :draggable="false"
            @loaded="natural = $event"
            @dblclick="zoom(scale === 1 ? 2 : 1)"
          />
        </div>
      </div>
      <p v-if="error" class="viewer-error" role="alert">{{ error }}</p>
      <footer class="viewer-controls" aria-label="图片缩放">
        <button
          type="button"
          aria-label="缩小图片"
          :disabled="scale <= 1"
          @click="zoom(scale / 1.5)"
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          class="viewer-scale"
          aria-label="恢复适应屏幕"
          :disabled="!natural.width"
          @click="zoom(1)"
        >
          {{ Math.round(scale * 100) }}%
        </button>
        <button
          type="button"
          aria-label="放大图片"
          :disabled="scale >= 5 || !natural.width"
          @click="zoom(scale * 1.5)"
        >
          <AppIcon name="plus" :size="20" />
        </button>
      </footer>
    </template>
  </dialog>
</template>
<style scoped>
.image-viewer {
  position: fixed;
  inset: 0;
  width: 100%;
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  border: 0;
  background: #101417;
  color: #eef2f4;
  overflow: hidden;
}
.image-viewer[open] {
  display: flex;
  flex-direction: column;
}
.image-viewer::backdrop {
  background: #101417;
}
.viewer-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
}
.viewer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #a8b2b9;
  padding-left: 4px;
}
button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  padding: 0;
  background: transparent;
  color: inherit;
}
button:hover:not(:disabled) {
  background: #ffffff12;
}
button:focus-visible {
  outline: 2px solid #a8c5bd;
  outline-offset: -2px;
}
button:disabled {
  opacity: 0.35;
}
.viewer-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: none;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
}
.viewer-canvas::-webkit-scrollbar {
  display: none;
}
.viewer-canvas.zoomed {
  cursor: grab;
}
.viewer-canvas.zoomed:active {
  cursor: grabbing;
}
.viewer-stage {
  display: grid;
  place-items: center;
  padding: 12px;
}
.viewer-image {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}
.viewer-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
}
.viewer-scale {
  width: 62px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #bdc7cc;
}
.viewer-controls span {
  font-size: 24px;
}
.viewer-error {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: #f2bba7;
  text-align: center;
}
</style>
