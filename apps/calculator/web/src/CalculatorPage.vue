<script setup lang="ts">
import type { CalculationInput, CalculationResult, CalculatorKind } from '@t-box/calculator-contracts'
import type { CalculationHistory } from './history'
import {
  calculatorCatalog,
  getCalculatorDefinition,
} from '@t-box/calculator-contracts'
import { AppIcon, Modal, SheetSelect, SidePanel } from '@t-box/ui-kit'
import { computed, ref, toRaw, watch } from 'vue'
import CalculationForm from './CalculationForm.vue'
import ExpressionCalculator from './ExpressionCalculator.vue'
import { loadHistory, saveHistory } from './history'
import { runtime } from './runtime'
import './calculator.css'

const props = defineProps<{
  kind?: string
  expression?: string
  openRevision?: number
}>()
const kind = ref<CalculatorKind>('scientific')
const revision = ref(0)
const restored = ref<CalculationInput | null>(null)
const historyOpen = ref(false)
const clearOpen = ref(false)
const copied = ref('')
const userId = () => runtime.subject
const records = ref<CalculationHistory[]>(loadHistory(userId()))
const definition = computed(() => getCalculatorDefinition(kind.value))
const options = calculatorCatalog.map((c) => ({
  value: c.id,
  label: c.title,
  description: c.description,
}))
const groups = [...new Set(calculatorCatalog.map((c) => c.group))]
function choose(value: CalculatorKind) {
  kind.value = value
  restored.value = null
  revision.value++
  copied.value = ''
}
watch(
  () => [props.kind, props.expression, props.openRevision],
  () => {
    choose((props.kind ?? 'scientific') as CalculatorKind)
    if (props.expression != null) {
      restored.value = {
        kind: kind.value,
        values: { expression: props.expression, angle: 'deg', ans: '0' },
      }
    }
  },
  { immediate: true },
)
watch(
  () => runtime.subject,
  () => {
    records.value = loadHistory(userId())
  },
)
function remember(input: CalculationInput, result: CalculationResult) {
  records.value = [
    {
      id: crypto.randomUUID(),
      input: structuredClone(input),
      result: structuredClone(toRaw(result)),
      time: new Date().toISOString(),
    },
    ...records.value,
  ].slice(0, 20)
  saveHistory(userId(), records.value)
}
function restore(record: CalculationHistory) {
  try {
    kind.value = getCalculatorDefinition(record.input.kind).id
    restored.value = record.input
    revision.value++
    historyOpen.value = false
  } catch {
    /* An obsolete entry cannot select unregistered code. */
  }
}
function clear() {
  records.value = []
  saveHistory(userId(), [])
  clearOpen.value = false
  historyOpen.value = false
}
async function copy(record: CalculationHistory) {
  try {
    await navigator.clipboard.writeText(
      record.result.items
        .map((item) => `${item.label}: ${item.value}${item.unit ?? ''}`)
        .join('\n'),
    )
    copied.value = record.id
  } catch {
    copied.value = 'failed'
  }
}
</script>

<template>
  <div class="calculator-page">
    <div class="calc-mobile-selector">
      <SheetSelect
        :model-value="kind"
        :options="options"
        label="计算类型"
        @update:model-value="choose"
      /><button
        v-if="records.length"
        class="calc-history-trigger"
        aria-label="计算历史"
        @click="historyOpen = true"
      >
        <AppIcon name="history" :size="20" />
      </button>
    </div>
    <div class="calc-layout">
      <aside class="calc-navigation" aria-label="计算类型">
        <div class="calc-nav-title">
          <span>数学工具</span><button
            v-if="records.length"
            class="calc-history-trigger"
            aria-label="计算历史"
            @click="historyOpen = true"
          >
            <AppIcon name="history" :size="18" />
          </button>
        </div>
        <section v-for="group in groups" :key="group">
          <h2>{{ group }}</h2>
          <button
            v-for="entry in calculatorCatalog.filter((c) => c.group === group)"
            :key="entry.id"
            :aria-current="kind === entry.id ? 'page' : undefined"
            @click="choose(entry.id)"
          >
            {{ entry.title
            }}<AppIcon
              v-if="kind === entry.id"
              name="right"
              :size="14"
            />
          </button>
        </section>
      </aside>
      <section
        class="calc-workbench"
        :class="{
          'calc-expression-mode': kind === 'basic' || kind === 'scientific',
        }"
        :aria-label="definition.title"
      >
        <header class="calc-workbench-heading">
          <h2>{{ definition.title }}</h2>
          <p>{{ definition.description }}</p>
          <span>本地计算 · 无需 AI · 不扣额度</span>
        </header>
        <ExpressionCalculator
          v-if="kind === 'basic' || kind === 'scientific'"
          :scientific="kind === 'scientific'"
          :initial-expression="restored?.values.expression ?? undefined"
          :initial-angle="restored?.values.angle ?? undefined"
          :initial-ans="restored?.values.ans ?? undefined"
          :revision="revision"
          @calculated="remember"
        />
        <CalculationForm
          v-else
          :definition="definition"
          :initial-values="restored?.values"
          :revision="revision"
          @calculated="remember"
        />
        <details class="calc-notes">
          <summary>计算说明</summary>
          <p>{{ definition.note }}</p>
        </details>
      </section>
    </div>
    <SidePanel
      :open="historyOpen"
      title="计算历史"
      @close="historyOpen = false"
    >
      <p class="calc-history-note">仅保留此账号在本机最近 20 次计算。</p>
      <article
        v-for="record in records"
        :key="record.id"
        class="calc-history-item"
      >
        <div>
          <strong>{{ record.result.title }}</strong><time>{{
            new Date(record.time).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          }}</time>
        </div>
        <p v-if="record.input.values.expression">
          {{ record.input.values.expression }}
        </p>
        <pre>{{ record.result.items[0]?.value }}</pre>
        <footer>
          <button @click="restore(record)">再次计算</button><button @click="copy(record)">
            {{ copied === record.id ? "已复制" : "复制结果" }}
          </button>
        </footer>
      </article>
      <p
        v-if="copied === 'failed'"
        role="status"
        class="calc-error"
      >
        复制不可用，可选中结果手动复制。
      </p>
      <template #footer>
        <button class="calc-clear-history" @click="clearOpen = true">
          清空计算历史
        </button>
      </template>
    </SidePanel>
    <Modal
      :open="clearOpen"
      title="清空计算历史"
      @close="clearOpen = false"
    >
      <p class="calc-history-note">清空此账号在本机的记录，清空后无法恢复。</p>
      <div class="calc-confirm-actions">
        <button class="button button-secondary" @click="clearOpen = false"> 取消</button><button class="button button-primary" @click="clear">清空</button>
      </div>
    </Modal>
  </div>
</template>
