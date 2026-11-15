<script setup lang="ts">
import { Modal } from '@t-box/ui-kit'

defineProps<{ open: boolean, title: string, long?: boolean, busy?: boolean }>()
defineEmits<{ close: [], save: [] }>()
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    :busy="busy"
    class="shop-dialog"
    :class="[{ 'shop-dialog-long': long }]"
    @close="$emit('close')"
  >
    <div class="shop-dialog-body"><slot /></div>
    <template #footer><button :disabled="busy" @click="$emit('close')">取消</button><button
      class="primary"
      :disabled="busy"
      @click="$emit('save')"
    >
      保存
    </button></template>
  </Modal>
</template>
