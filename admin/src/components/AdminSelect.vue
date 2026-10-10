<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import AdminIcon from './AdminIcon.vue'

export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}
const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    label: string
    placeholder?: string
    disabled?: boolean
    searchable?: boolean
    required?: boolean
    emptyText?: string
  }>(),
  { placeholder: '请选择', emptyText: '没有可选项' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const trigger = ref<HTMLButtonElement>()
const popup = ref<HTMLDivElement>()
const search = ref<HTMLInputElement>()
const opened = ref(false)
const query = ref('')
const style = ref<Record<string, string>>({})
const listId = useId()
const current = computed(() =>
  props.options.find((o) => o.value === props.modelValue),
)
const filtered = computed(() =>
  props.options.filter((o) =>
    `${o.label} ${o.description || ''}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
)
function position() {
  if (!trigger.value) {
    return
  }
  const r = trigger.value.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - 12
  const above = r.top - 12
  const flip = below < 200 && above > below
  style.value = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))}px`,
    width: `${Math.min(r.width, window.innerWidth - 16)}px`,
    maxHeight: `${Math.max(100, Math.min(350, flip ? above : below))}px`,
    ...(flip
      ? { bottom: `${window.innerHeight - r.top + 6}px` }
      : { top: `${r.bottom + 6}px` }),
  }
}
function close(focus = false) {
  if (!opened.value) {
    return
  }
  opened.value = false
  popup.value?.hidePopover?.()
  if (focus) {
    trigger.value?.focus()
  }
}
async function open(focusOption = false) {
  if (props.disabled || trigger.value?.matches(':disabled')) {
    return
  }
  query.value = ''
  opened.value = true
  await nextTick()
  if (!opened.value) {
    return
  }
  position()
  popup.value?.showPopover?.()
  if (props.searchable && !focusOption) {
    search.value?.focus()
  } else {
    (
      popup.value?.querySelector<HTMLElement>(
        '[aria-selected="true"]:not(:disabled)',
      ) ||
      popup.value?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')
    )?.focus()
  }
}
function choose(option: SelectOption) {
  if (!option.disabled) {
    emit('update:modelValue', option.value)
    close(true)
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.target === search.value) {
    event.preventDefault()
    const option = filtered.value.find((option) => !option.disabled)
    if (option) {
      choose(option)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (event.key === 'Tab') {
    close()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return
  }
  if (event.target === search.value && ['Home', 'End'].includes(event.key)) {
    return
  }
  event.preventDefault()
  const buttons = [
    ...(popup.value?.querySelectorAll<HTMLButtonElement>(
      '[role="option"]:not(:disabled)',
    ) || []),
  ]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : index <= 0
            ? buttons.length - 1
            : index - 1
  buttons[next]?.focus()
}
function outside(event: PointerEvent) {
  if (
    !popup.value?.contains(event.target as Node) &&
    !trigger.value?.contains(event.target as Node)
  ) {
    close()
  }
}
watch(opened, (value) => {
  if (value) {
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
  } else {
    removeListeners()
  }
})
watch(
  () => props.disabled,
  (value) => {
    if (value) {
      close()
    }
  },
)
function removeListeners() {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
}
onBeforeUnmount(() => {
  close()
  removeListeners()
})
</script>

<template>
  <div class="admin-select">
    <button
      ref="trigger"
      type="button"
      class="select-trigger"
      :class="{ placeholder: !current, expanded: opened }"
      role="combobox"
      :aria-label="label"
      :aria-expanded="opened"
      aria-haspopup="listbox"
      :aria-controls="listId"
      :disabled="disabled"
      @click="opened ? close(true) : open()"
      @keydown.down.prevent="open(true)"
      @keydown.up.prevent="open(true)"
    >
      <span>{{ current?.label || placeholder }}</span><AdminIcon name="chevron" :size="16" />
    </button>
    <input
      v-if="required"
      class="select-validity"
      tabindex="-1"
      aria-hidden="true"
      :value="modelValue"
      required
      :disabled="disabled"
      @invalid.prevent="open()"
    >
    <div
      ref="popup"
      class="select-popover"
      popover="manual"
      :style="{ ...style, ...(!opened ? { display: 'none' } : {}) }"
      @keydown="keydown"
    >
      <div v-if="searchable" class="select-search">
        <AdminIcon name="search" :size="16" /><input
          ref="search"
          v-model="query"
          :aria-label="`搜索${label}`"
          placeholder="输入关键词搜索…"
          autocomplete="off"
        >
      </div>
      <div
        :id="listId"
        role="listbox"
        :aria-label="label"
        class="select-options"
      >
        <button
          v-for="option in filtered"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          :disabled="option.disabled"
          @click="choose(option)"
        >
          <span>{{ option.label
          }}<small v-if="option.description">{{
            option.description
          }}</small></span><AdminIcon
            v-if="option.value === modelValue"
            name="check"
            :size="16"
          />
        </button>
        <p v-if="!filtered.length" class="select-empty">
          {{ query ? "没有匹配的选项" : emptyText }}
        </p>
      </div>
    </div>
  </div>
</template>
