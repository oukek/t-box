<script setup lang="ts">
import type { Route } from '@t-box/shop-tools-contracts'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, nextTick, ref, watch } from 'vue'
import {
  buildRouteTree,
  routeLevels,
  routePrefix,
  selectedRouteKey,
} from './routeTree'

const props = defineProps<{ modelValue: string, routes: readonly Route[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const selection = ref<string[]>([])
const columnsElement = ref<HTMLElement>()
const tree = computed(() => buildRouteTree(props.routes))
const current = computed(() =>
  props.routes.find((r) => r.key === props.modelValue),
)
const candidate = computed(() =>
  props.routes.find(
    (r) => r.key === selectedRouteKey(tree.value, selection.value),
  ),
)
const columns = computed(() => {
  let options = tree.value
  return routeLevels.map((label, index) => {
    const column = { label, index, options, selected: selection.value[index] }
    options =
      options.find((node) => node.id === selection.value[index])?.children ?? []
    return column
  })
})
const selectionSummary = computed(() => {
  if (candidate.value) {
    return candidate.value.label
  }
  if (!tree.value.length) {
    return '暂无可用方案'
  }
  const labels = columns.value.flatMap((column) => {
    const node = column.options.find((node) => node.id === column.selected)
    return node ? [node.label] : []
  })
  return [...labels, `请选择${routeLevels[labels.length] ?? '地区'}`].join(
    ' / ',
  )
})
function initialize() {
  selection.value = current.value
    ? [current.value.site, ...current.value.path]
    : tree.value[0]
      ? [tree.value[0].id]
      : []
}
watch(open, (value) => {
  if (value) {
    initialize()
  }
})
watch(tree, () => {
  if (!open.value) {
    return
  }
  selection.value = routePrefix(tree.value, selection.value)
  if (!selection.value.length) {
    initialize()
  }
})
function choose(level: number, id: string) {
  if (selection.value[level] === id) {
    return
  }
  selection.value = [...selection.value.slice(0, level), id]
  if (level < 3) {
    void nextTick(() =>
      columnsElement.value?.children[level + 1]?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      }),
    )
  }
}
function confirm() {
  if (!candidate.value) {
    return
  }
  emit('update:modelValue', candidate.value.key)
  open.value = false
}
function move(event: KeyboardEvent, level: number) {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const next = level + (event.key === 'ArrowRight' ? 1 : -1)
    if (next < 0 || next > 3) {
      return
    }
    if (event.key === 'ArrowRight') {
      const id = (document.activeElement as HTMLElement)?.dataset.routeId
      if (id) {
        choose(level, id)
      }
    }
    void nextTick(() => {
      const column = columnsElement.value?.children[next]
      const target =
        column?.querySelector<HTMLButtonElement>(
          '[role=option][aria-selected=true]',
        ) ?? column?.querySelector<HTMLButtonElement>('[role=option]')
      target?.focus()
    })
    return
  }

  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return
  }
  event.preventDefault()
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role=option]',
    ),
  )
  if (!buttons.length) {
    return
  }
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
          buttons.length
  buttons[next]?.focus()
}
</script>

<template>
  <button
    type="button"
    class="sheet-select-trigger route-picker-trigger"
    :aria-label="`物流方案：${current?.label || '请选择'}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <span>{{ current?.label || '请选择物流方案' }}</span><AppIcon name="down" :size="16" />
  </button>
  <BottomSheet
    :open="open"
    title="选择物流方案"
    desktop-modal
    @close="open = false"
  >
    <div class="route-cascade">
      <p class="cascade-hint">依次选择站点、货物类型、渠道和地区。</p>
      <p
        v-if="!tree.length"
        class="cascade-empty"
        role="status"
      >
        暂无可用方案，请等待费率加载，或返回刷新数据。
      </p>
      <div v-else class="cascade-scroll">
        <div ref="columnsElement" class="cascade-columns">
          <section
            v-for="column in columns"
            :key="column.label"
            class="cascade-column"
          >
            <h3>{{ column.label }}</h3>
            <div
              class="cascade-options"
              role="listbox"
              :aria-label="column.label"
              @keydown="move($event, column.index)"
            >
              <button
                v-for="node in column.options"
                :key="node.id"
                type="button"
                role="option"
                :aria-selected="column.selected === node.id"
                :data-route-id="node.id"
                @click="choose(column.index, node.id)"
              >
                <span>{{ node.label }}</span><AppIcon
                  v-if="column.selected === node.id"
                  name="check"
                  :size="14"
                /><AppIcon
                  v-else-if="column.index < 3"
                  name="right"
                  :size="14"
                />
              </button>
              <p v-if="!column.options.length" class="cascade-placeholder">
                请先选择{{ routeLevels[column.index - 1] }}
              </p>
            </div>
          </section>
        </div>
      </div>
      <p class="cascade-path">{{ selectionSummary }}</p>
    </div>
    <template #footer><button @click="open = false">取消</button><button
      class="primary"
      :disabled="!candidate"
      @click="confirm"
    >
      使用方案
    </button></template>
  </BottomSheet>
</template>

<style scoped>
.route-picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  text-align: left;
}
.route-picker-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.route-picker-trigger > svg {
  flex-shrink: 0;
  color: var(--muted);
}
.cascade-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 12px;
}
.cascade-scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.cascade-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  height: min(420px, 50dvh);
  min-height: 200px;
}
.cascade-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--line);
}
.cascade-column:last-child {
  border-right: 0;
}
.cascade-column h3 {
  font-size: 12px;
  font-weight: 500;
  padding: 10px 12px;
  margin: 0;
  background: #f4f7fa;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.cascade-options {
  padding: 5px;
  overflow: auto;
  overscroll-behavior: contain;
  min-height: 0;
  flex: 1;
}
.cascade-options button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  border: 1px solid transparent;
  padding: 8px;
  font-size: 12px;
  text-align: left;
  margin: 2px 0;
  background: transparent;
}
.cascade-options button > span {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.cascade-options button > svg {
  flex-shrink: 0;
  color: var(--muted);
}
.cascade-options button[aria-selected='true'] {
  background: #fff1eb;
  color: var(--accent);
  border-color: #fad0c5;
}
.cascade-options button:hover {
  background: #f4f7fa;
}
.cascade-options button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.cascade-placeholder,
.cascade-empty {
  font-size: 12px;
  color: var(--muted);
  padding: 16px 8px;
}
.cascade-path {
  font-size: 12px;
  line-height: 1.5;
  min-height: 18px;
  margin: 12px 0 0;
  color: var(--muted);
  overflow-wrap: anywhere;
}
:global(.sheet-dialog.sheet-desktop-modal:has(.route-cascade)) {
  width: min(960px, calc(100% - 48px));
}
@keyframes route-picker-enter {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
@media (max-width: 760px) {
  :global(.sheet-dialog.sheet-desktop-modal[open]:has(.route-cascade)) {
    animation: route-picker-enter 0.18s ease-out;
  }

  :global(.sheet-dialog.sheet-desktop-modal:has(.route-cascade)) {
    inset: 0;
    margin: 0;
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  :global(.sheet-dialog:has(.route-cascade) .sheet-handle) {
    display: none;
  }
  :global(.sheet-dialog:has(.route-cascade) .sheet-body) {
    flex: 1;
  }
  .cascade-columns {
    min-width: 600px;
    height: calc(100dvh - 210px - env(safe-area-inset-bottom));
    max-height: none;
  }
  .cascade-options button {
    min-height: 42px;
  }
  .cascade-hint {
    font-size: 11px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :global(.sheet-dialog.sheet-desktop-modal[open]:has(.route-cascade)) {
    animation: none;
  }
}
</style>
