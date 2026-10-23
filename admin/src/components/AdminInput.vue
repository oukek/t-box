<script setup lang="ts" generic="T extends string | number | null | undefined">
import { ref } from 'vue'

withDefaults(defineProps<{ type?: string }>(), { type: 'text' })
const model = defineModel<T>()
const input = ref<HTMLInputElement>()

defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() })
</script>

<template>
  <input
    ref="input"
    v-model="model"
    :type="type"
    class="admin-control admin-input"
  >
</template>
