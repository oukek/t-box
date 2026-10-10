<script setup lang="ts">
import type { Resource } from '@t-box/shared'
import { onBeforeUnmount, ref, watch } from 'vue'
import { resourceBlob } from '../features/resources/resourcesApi'

const props = defineProps<{ resource: Resource }>()
const emit = defineEmits<{
  rendered: []
  loaded: [size: { width: number, height: number }]
}>()
const url = ref('')
const error = ref('')
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  emit('loaded', { width: image.naturalWidth, height: image.naturalHeight })
  emit('rendered')
}
function failed() {
  if (url.value) {
    URL.revokeObjectURL(url.value)
  }
  url.value = ''
  error.value = '图片无法显示'
  emit('rendered')
}
let controller: AbortController | undefined
function clear() {
  controller?.abort()
  if (url.value) {
    URL.revokeObjectURL(url.value)
  }
  url.value = ''
}
watch(
  () => props.resource.id,
  async () => {
    clear()
    error.value = ''
    const current = (controller = new AbortController())
    try {
      const blob = await resourceBlob(props.resource, current.signal)
      if (!current.signal.aborted) {
        url.value = URL.createObjectURL(blob)
      }
    } catch {
      if (!current.signal.aborted) {
        error.value = '图片不可访问'
      }
    }
  },
  { immediate: true },
)
onBeforeUnmount(clear)
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="resource.name"
    loading="lazy"
    @load="loaded"
    @error="failed"
  ><span
    v-else
    class="resource-placeholder"
    role="status"
  >{{
    error || "加载图片…"
  }}</span>
</template>
