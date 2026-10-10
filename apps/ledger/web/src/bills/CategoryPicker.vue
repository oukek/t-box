<script setup lang="ts">
import type { BillCategory, CategoryId } from '@t-box/ledger-contracts'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, ref } from 'vue'
import CategoryIcon from '../categories/CategoryIcon.vue'

const props = defineProps<{
  ledgerId: string
  categories: BillCategory[]
  type: 'expense' | 'income'
  disabled?: boolean
}>()
const selected = defineModel<CategoryId>({ required: true })
const expanded = ref(false)
const search = ref('')
const hasMore = computed(() => props.categories.length > 18)
const preview = computed(() => {
  if (!hasMore.value) {
    return props.categories
  }
  const items = props.categories.slice(0, 17)
  const current = props.categories.find((item) => item.id === selected.value)
  // Keep the chosen category visible without changing the saved category order.
  if (current && !items.some((item) => item.id === current.id)) {
    items[16] = current
  }
  return items
})
const results = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return query
    ? props.categories.filter((item) =>
        item.label.toLocaleLowerCase().includes(query),
      )
    : props.categories
})
function openAll() {
  search.value = ''
  expanded.value = true
}
function choose(id: CategoryId) {
  if (props.disabled) {
    return
  }
  selected.value = id
  expanded.value = false
}
</script>

<template>
  <div class="ledger-category-grid" aria-label="账单分类">
    <label
      v-for="category in preview"
      :key="category.id"
      class="ledger-category-tile"
      :class="{ selected: selected === category.id }"
      :title="category.label"
    >
      <input
        v-model="selected"
        type="radio"
        name="category"
        :value="category.id"
        :disabled="disabled"
      >
      <CategoryIcon
        :ledger-id="ledgerId"
        :icon="category.icon"
        :icon-id="category.iconId"
        :size="16"
      />
      <span>{{ category.label }}</span>
    </label>
    <button
      v-if="hasMore"
      type="button"
      class="ledger-category-tile ledger-category-more"
      aria-label="更多分类"
      aria-haspopup="dialog"
      :aria-expanded="expanded"
      :disabled="disabled"
      @click="openAll"
    >
      <AppIcon name="other" :size="16" />
      <span>更多</span>
    </button>
  </div>
  <p v-if="!categories.length" class="ledger-category-empty">
    暂无分类，请先添加分类。
  </p>

  <BottomSheet
    :open="expanded"
    :title="type === 'income' ? '全部收入分类' : '全部支出分类'"
    :busy="disabled"
    full-height
    compact
    @close="expanded = false"
  >
    <div class="ledger-category-search">
      <label class="ledger-category-search-field">
        <AppIcon name="search" :size="16" />
        <input
          v-model="search"
          type="search"
          placeholder="搜索分类"
          aria-label="搜索分类"
        >
      </label>
      <span class="ledger-category-count">{{ results.length }} 个分类</span>
    </div>
    <div class="ledger-category-grid" aria-label="全部账单分类">
      <button
        v-for="category in results"
        :key="category.id"
        type="button"
        class="ledger-category-tile"
        :class="{ selected: selected === category.id }"
        :aria-pressed="selected === category.id"
        :title="category.label"
        :disabled="disabled"
        @click="choose(category.id)"
      >
        <CategoryIcon
          :ledger-id="ledgerId"
          :icon="category.icon"
          :icon-id="category.iconId"
          :size="16"
        />
        <span>{{ category.label }}</span>
      </button>
    </div>
    <p v-if="!results.length" class="ledger-category-empty">
      没有找到分类，试试其他关键词。
    </p>
    <template #footer>
      <button
        type="button"
        class="button button-secondary ledger-category-back"
        @click="expanded = false"
      >
        返回记账
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.ledger-category-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 5px;
}
.ledger-category-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 48px;
  gap: 4px;
  padding: 6px 2px;
  border: 1px solid #edf1f3;
  border-radius: 6px;
  background: #f8fafb;
  color: #6c7e8c;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ledger-category-tile > span {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
  line-height: 1.3;
}
.ledger-category-tile input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.ledger-category-tile.selected {
  background: #edf6f3;
  border-color: #bbd8d1;
  color: var(--accent);
}
.ledger-category-tile:focus-visible,
.ledger-category-tile:has(input:focus-visible) {
  outline: 2px solid var(--focus-border);
  outline-offset: 1px;
}
.ledger-category-tile:disabled,
.ledger-category-tile:has(input:disabled) {
  cursor: default;
  opacity: 0.6;
}
.ledger-category-more {
  background: transparent;
  border-style: dashed;
}
.ledger-category-search {
  position: sticky;
  top: -4px;
  z-index: 1;
  background: #fff;
  padding: 4px 0 12px;
}
.ledger-category-search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid #dfe6ea;
  border-radius: 7px;
  color: #8996a0;
  background: #fbfcfc;
}
.ledger-category-search-field:focus-within {
  border-color: var(--focus-border);
}
.ledger-category-search-field input {
  min-width: 0;
  width: 100%;
  min-height: 42px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  font-size: 16px;
  outline: none;
}
.ledger-category-count {
  display: block;
  margin-top: 8px;
  color: #8996a0;
  font-size: 11px;
}
.ledger-category-empty {
  margin: 16px 0;
  color: #8996a0;
  font-size: 12px;
}
.ledger-category-back {
  width: 100%;
}
</style>
