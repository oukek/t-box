<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'
import { ref, watch } from 'vue'
import { featureApi } from '../features/api'

const props = withDefaults(
  defineProps<{
    ledgerId: string
    icon?: string
    iconId?: string | null
    size?: number
  }>(),
  { size: 18, icon: 'other' },
)
const source = ref('')
let version = 0
watch(
  () => [props.ledgerId, props.iconId],
  async () => {
    const current = ++version
    source.value = ''
    if (!props.iconId) {
      return
    }
    try {
      const data = await featureApi(props.ledgerId).get<{ base64: string }>(
        `/category-icons/${props.iconId}`,
      )
      if (current === version) {
        source.value = `data:image/png;base64,${data.base64}`
      }
    } catch {
      /* Keep the built-in icon visible when a thumbnail cannot be loaded. */
    }
  },
  { immediate: true },
)
</script>

<template>
  <img
    v-if="source"
    :src="source"
    alt=""
    :width="size"
    :height="size"
    class="category-image"
    @error="source = ''"
  ><AppIcon
    v-else
    :name="icon"
    :size="size"
  />
</template>

<style scoped>
.category-image {
  object-fit: contain;
  flex: none;
  border-radius: 4px;
  display: block;
}
</style>
