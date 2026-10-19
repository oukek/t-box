<script setup lang="ts">
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'

interface SelectionOption { id: string, name: string, symbol?: string, description?: string, keywords?: readonly string[], aliases?: readonly string[] }
const props = defineProps<{ modelValue: string, options: readonly SelectionOption[], title: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const search = ref('')
const selected = computed(() => props.options.find((item) => item.id === props.modelValue))
const filtered = computed(() => props.options.filter((item) => [item.id, item.name, item.symbol || '', ...(item.keywords || []), ...(item.aliases || [])].some((value) => value.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))))
watch(open, () => {
  search.value = ''
})
function choose(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <button
    class="unit-picker"
    type="button"
    :aria-label="`${title}：${selected?.name || '请选择'}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <span><strong>{{ selected?.symbol || selected?.name || '请选择' }}</strong><small v-if="selected?.symbol">{{ selected.name }}</small></span><AppIcon name="down" :size="16" />
  </button>
  <BottomSheet
    :open="open"
    :title="title"
    @close="open = false"
  >
    <div class="unit-sheet-search"><AppIcon name="search" :size="17" /><input
      v-model="search"
      type="search"
      :aria-label="`搜索${title}`"
      placeholder="搜索名称、符号或英文"
      autocomplete="off"
    ></div>
    <div
      class="unit-sheet-list"
      role="listbox"
      :aria-label="title"
    >
      <button
        v-for="option in filtered"
        :key="option.id"
        type="button"
        role="option"
        :aria-selected="option.id === modelValue"
        @click="choose(option.id)"
      >
        <span><strong>{{ option.name }}</strong><small v-if="option.description">{{ option.description }}</small></span><span class="unit-symbol">{{ option.symbol }}</span><AppIcon
          v-if="option.id === modelValue"
          name="check"
          :size="17"
        />
      </button>
      <p v-if="!filtered.length" class="unit-empty">没有找到单位，试试其他名称或符号。</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.unit-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 0;
  background: transparent;
  padding: 8px 0;
  min-width: 0;
  text-align: left;
  color: inherit;
  min-height: 44px;
  width: 100%;
}
.unit-picker span {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.unit-picker strong {
  font-size: 17px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.unit-picker small {
  font-size: 11px;
  color: var(--muted);
}
.unit-picker svg {
  color: var(--muted);
}
.unit-sheet-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 10px;
  margin-bottom: 12px;
  background: #fff;
}
.unit-sheet-search input {
  flex: 1;
  min-width: 0;
  height: 40px;
  border: 0;
  background: transparent;
  font-size: 14px;
}
.unit-sheet-list {
  display: grid;
  gap: 4px;
}
.unit-sheet-list button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  padding: 12px 10px;
  text-align: left;
  border-radius: 9px;
  min-height: 48px;
}
.unit-sheet-list button[aria-selected='true'] {
  background: #eaf2fc;
  color: #326b9f;
}
.unit-sheet-list strong {
  display: block;
  font-size: 14px;
  font-weight: 500;
}
.unit-sheet-list small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
  margin-top: 3px;
}
.unit-symbol {
  font: 12px var(--number-font);
  color: var(--muted);
}
</style>
