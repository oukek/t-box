<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { resourceBlob } from '../../core/resources'
import { identity } from '../../core/session'

const props = defineProps<{ id: string, title: string }>()
const url = ref('')
const error = ref('')
let controller: AbortController | undefined
function clear() {
  controller?.abort()
  if (url.value) {
    URL.revokeObjectURL(url.value)
    url.value = ''
  }
}
watch(() => [props.id, identity.user?.id], async () => {
  clear()
  error.value = ''
  const current = new AbortController()
  controller = current
  try {
    const blob = await resourceBlob({ id: props.id }, current.signal)
    if (!current.signal.aborted) {
      url.value = URL.createObjectURL(blob)
    }
  } catch {
    if (!current.signal.aborted) {
      error.value = '图片已删除或不可访问'
    }
  }
}, { immediate: true })
onBeforeUnmount(clear)
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="title"
    loading="lazy"
    class="notification-image"
  >
  <p v-else class="notification-image-placeholder">{{ error || '正在读取图片…' }}</p>
</template>

<style scoped>
.notification-image {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: 10px;
  background: #edf2f1;
}
.notification-image-placeholder {
  padding: 28px 12px;
  color: var(--muted);
  text-align: center;
  background: #f1f5f4;
  border-radius: 10px;
}
</style>
