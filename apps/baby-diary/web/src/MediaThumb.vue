<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { errorText, imageUrl, onPrivateClear } from './runtime'

const props = defineProps<{ id: string, alt?: string }>()
const url = ref('')
const error = ref('')
const container = ref<HTMLElement>()
const visible = ref(false)
let revision = 0
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true
        observer?.disconnect()
      }
    },
    { rootMargin: '200px' },
  )
  if (container.value) {
    observer.observe(container.value)
  }
})
const stop = onPrivateClear(() => {
  revision++
  url.value = ''
})
watch(
  [() => props.id, visible],
  async ([id, show]) => {
    const current = ++revision
    url.value = ''
    error.value = ''
    if (!show) {
      return
    }
    try {
      const result = await imageUrl(id)
      if (current === revision) {
        url.value = result
      }
    } catch (e) {
      if (current === revision) {
        error.value = errorText(e)
      }
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  revision++
  observer?.disconnect()
  stop()
})
</script>

<template>
  <span
    ref="container"
    class="media-frame"
  ><img
    v-if="url"
    :src="url"
    :alt="alt || '宝宝照片'"
    decoding="async"
  ><span
    v-else
    class="media-placeholder"
    :title="error"
    role="img"
    :aria-label="error || '照片加载中'"
  >{{ error ? "无法查看" : "···" }}</span></span>
</template>
