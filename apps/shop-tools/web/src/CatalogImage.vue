<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CatalogMedia } from '@t-box/shop-tools-contracts'
import { ref, watch } from 'vue'

const props = defineProps<{ client: AppClient, projectId: string, productId: string, asset: CatalogMedia, alt: string }>()
const src = ref('')
const error = ref('')
let sequence = 0
async function load() {
  const current = ++sequence
  src.value = ''
  error.value = ''
  if (!props.asset.fileId) {
    src.value = props.asset.url
    return
  }
  try {
    const result = await props.client.api.invoke<{ mime: string, base64: string }>('catalog', { action: 'ai-image', projectId: props.projectId, productId: props.productId, fileId: props.asset.fileId })
    if (current === sequence) {
      src.value = 'data:' + result.mime + ';base64,' + result.base64
    }
  } catch {
    if (current === sequence) {
      error.value = '图片读取失败'
    }
  }
}
watch(() => [props.asset.fileId, props.asset.url, props.projectId, props.productId], load, { immediate: true })
</script>

<template>
  <img
    v-if="src && !error"
    :src="src"
    :alt="alt"
    loading="lazy"
    referrerpolicy="no-referrer"
    @error="error = '图片读取失败'"
  ><button
    v-else-if="error"
    type="button"
    @click="load"
  >{{ error }}，重试</button><span v-else>图片加载中…</span>
</template>
