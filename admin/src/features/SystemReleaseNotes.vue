<script setup lang="ts">
import FormControl from '@t-box/ui-kit/FormControl.vue'

defineProps<{ readonly?: boolean }>()
const notes = defineModel<string>({ required: true })
</script>

<template>
  <label class="release-notes">
    <span>更新内容</span>
    <FormControl
      v-model="notes"
      multiline
      :rows="4"
      maxlength="1000"
      required
      :readonly="readonly"
    />
    <small>{{ readonly ? '恢复发布沿用首次确认的内容。' : '每行一项，「优化修复 bug」会自动保留在最后。' }}</small>
  </label>
</template>

<style scoped>
.release-notes {
  display: grid;
  gap: 6px;
  margin-block: 14px;
  font-size: 14px;
}
.release-notes small {
  color: #616875;
}
</style>
