<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const viewport = ref<HTMLDivElement>()
interface Anchor { x: number, y: number, contentX: number, contentY: number }
let anchor: Anchor | undefined
let pinch:
  | { distance: number, scale: number, contentX: number, contentY: number } |
  undefined
function point(clientX: number, clientY: number): Anchor {
  const el = viewport.value!
  const rect = el.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  return {
    x,
    y,
    contentX: (el.scrollLeft + x) / props.modelValue,
    contentY: (el.scrollTop + y) / props.modelValue,
  }
}
function change(value: number, focus: Anchor) {
  const next = Math.round(Math.max(0.6, Math.min(1.8, value)) * 100) / 100
  if (next === props.modelValue) {
    anchor = undefined
    return
  }
  anchor = focus
  emit('update:modelValue', next)
}
function start(event: TouchEvent) {
  if (event.touches.length !== 2) {
    pinch = undefined
    return
  }
  event.preventDefault()
  const [a, b] = Array.from(event.touches) as [Touch, Touch]
  const p = point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
  pinch = {
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    scale: props.modelValue,
    contentX: p.contentX,
    contentY: p.contentY,
  }
}
function move(event: TouchEvent) {
  if (event.touches.length !== 2) {
    return
  }
  event.preventDefault()
  if (!pinch) {
    start(event)
    return
  }
  const [a, b] = Array.from(event.touches) as [Touch, Touch]
  const rect = viewport.value!.getBoundingClientRect()
  if (pinch.distance < 1) {
    return
  }
  change(
    (pinch.scale * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) /
    pinch.distance,
    {
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
      contentX: pinch.contentX,
      contentY: pinch.contentY,
    },
  )
}
function end() {
  pinch = undefined
}
function wheel(event: WheelEvent) {
  if (!event.ctrlKey) {
    return
  }
  event.preventDefault()
  change(
    props.modelValue * Math.exp(-event.deltaY * 0.006),
    point(event.clientX, event.clientY),
  )
}
function focusCell(event: FocusEvent) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) {
    return
  }
  requestAnimationFrame(() => {
    const el = viewport.value
    if (!el || !input.isConnected) {
      return
    }
    const rect = el.getBoundingClientRect()
    const cell = input.getBoundingClientRect()
    const fixed = el.querySelector('tbody th')?.getBoundingClientRect().width ?? 0
    const left = rect.left + fixed
    if (cell.left < left) {
      el.scrollLeft -= left - cell.left
    } else if (cell.right > rect.right) {
      el.scrollLeft += cell.right - rect.right
    }
  })
}
watch(
  () => props.modelValue,
  (value, previous) => {
    const el = viewport.value
    if (!el) {
      return
    }
    const p = anchor ?? {
      x: el.clientWidth / 2,
      y: el.clientHeight / 2,
      contentX: (el.scrollLeft + el.clientWidth / 2) / previous,
      contentY: (el.scrollTop + el.clientHeight / 2) / previous,
    }
    anchor = undefined
    void nextTick(() => {
      el.scrollLeft = p.contentX * value - p.x
      el.scrollTop = p.contentY * value - p.y
    })
  },
)
onMounted(() => {
  const el = viewport.value!
  el.addEventListener('touchstart', start, { passive: false })
  el.addEventListener('touchmove', move, { passive: false })
  el.addEventListener('touchend', end)
  el.addEventListener('touchcancel', end)
  el.addEventListener('wheel', wheel, { passive: false })
})
onUnmounted(() => {
  const el = viewport.value
  if (!el) {
    return
  }
  el.removeEventListener('touchstart', start)
  el.removeEventListener('touchmove', move)
  el.removeEventListener('touchend', end)
  el.removeEventListener('touchcancel', end)
  el.removeEventListener('wheel', wheel)
})
</script>

<template>
  <div
    ref="viewport"
    class="table-scroll pricing-viewport"
    role="region"
    aria-label="商品定价表，可双指缩放"
    tabindex="0"
    @focusin="focusCell"
  >
    <div class="table-surface" :style="{ zoom: modelValue }"><slot /></div>
  </div>
</template>
