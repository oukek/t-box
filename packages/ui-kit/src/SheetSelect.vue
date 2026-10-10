<script setup lang="ts" generic="T extends string | number | boolean">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import BottomSheet from './BottomSheet.vue'

const props = defineProps<{
  modelValue: T
  options: readonly {
    value: T
    label: string
    description?: string
    disabled?: boolean
  }[]
  label: string
  disabled?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const open = ref(false)
const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)
function choose(value: T) {
  emit('update:modelValue', value)
  open.value = false
}
function move(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return
  }
  event.preventDefault()
  const options = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ),
  ]
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
          options.length
  options[next]?.focus()
}
</script>

<template>
  <button
    type="button"
    class="sheet-select-trigger"
    :aria-label="`${label}：${selected?.label || placeholder || '请选择'}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :disabled="disabled"
    @click="open = true"
  >
    <span>{{ selected?.label || placeholder || "请选择" }}</span><AppIcon name="down" :size="16" />
  </button><BottomSheet
    :open="open"
    :title="label"
    @close="open = false"
  >
    <div
      class="sheet-options"
      role="listbox"
      :aria-label="label"
      @keydown="move"
    >
      <button
        v-for="option in options"
        :key="String(option.value)"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        :disabled="option.disabled"
        @click="choose(option.value)"
      >
        <span><strong>{{ option.label }}</strong><small v-if="option.description">{{
          option.description
        }}</small></span><AppIcon
          v-if="option.value === modelValue"
          name="check"
          :size="20"
        />
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.sheet-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #dce5e8;
  border-radius: 9px;
  background: #fff;
  color: #385363;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.sheet-select-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-select-trigger > svg {
  flex-shrink: 0;
  color: #8ca09f;
}
.sheet-select-trigger:hover:not(:disabled) {
  border-color: #a7c5be;
}
.sheet-options {
  display: grid;
  gap: 5px;
}
.sheet-options button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  padding: 17px 14px;
  border-radius: 12px;
  text-align: left;
  color: var(--ink);
  min-height: 58px;
}
.sheet-options button[aria-selected='true'] {
  background: #edf5f2;
  border-color: #e0ede6;
  color: var(--accent);
}
.sheet-options strong {
  font-size: 14px;
  font-weight: 500;
}
.sheet-options small {
  display: block;
  margin-top: 7px;
  font-size: 11px;
  line-height: 1.7;
  color: #8a9b9e;
}
.sheet-options button:hover:not(:disabled) {
  background: #f2f7f5;
}
</style>
