<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{ rows?: number | string, monospace?: boolean }>(), { rows: 4 })
const model = defineModel<string>()
const textarea = ref<HTMLTextAreaElement>()

defineExpose({ focus: () => textarea.value?.focus(), select: () => textarea.value?.select() })
</script>

<template>
  <textarea
    ref="textarea"
    v-model="model"
    :rows="rows"
    class="admin-control admin-textarea"
    :class="{ 'admin-textarea-monospace': monospace }"
  />
</template>
