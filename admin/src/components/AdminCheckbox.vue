<script setup lang="ts" generic="T extends boolean | string[]">
import AdminIcon from './AdminIcon.vue'

defineOptions({ inheritAttrs: false })
const model = defineModel<T>({ required: true })
</script>

<template>
  <span class="admin-checkbox">
    <input
      v-bind="$attrs"
      v-model="model"
      type="checkbox"
    >
    <span class="admin-checkbox-mark" aria-hidden="true"><AdminIcon name="check" :size="13" /></span>
  </span>
</template>
