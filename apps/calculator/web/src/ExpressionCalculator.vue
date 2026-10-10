<script setup lang="ts">
import type { CalculationInput, CalculationResult } from '@t-box/calculator-contracts'
import {
  calculate,
  evaluateExpression,
  formatNumber,
} from '@t-box/calculator-contracts'
import { AppIcon } from '@t-box/ui-kit'
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  scientific: boolean
  initialExpression?: string
  initialAngle?: string
  initialAns?: string
  revision: number
}>()
const emit = defineEmits<{
  calculated: [input: CalculationInput, result: CalculationResult]
}>()
const expression = ref('')
const angle = ref<'deg' | 'rad'>('deg')
const ans = ref('0')
const error = ref('')
const completed = ref(false)
const completedResult = ref('0')
const input = ref<HTMLTextAreaElement>()
watch(
  () => [
    props.initialExpression,
    props.initialAngle,
    props.initialAns,
    props.revision,
  ],
  () => {
    expression.value = props.initialExpression ?? ''
    angle.value = props.initialAngle === 'rad' ? 'rad' : 'deg'
    if (props.initialAns != null) {
      ans.value = props.initialAns
    }
    error.value = ''
    completed.value = false
  },
  { immediate: true },
)
const preview = computed(() => {
  if (completed.value) {
    return completedResult.value
  }
  if (!expression.value.trim()) {
    return '0'
  }
  try {
    return formatNumber(
      evaluateExpression(expression.value, angle.value, Number(ans.value)),
    )
  } catch {
    return '—'
  }
})
const keys = [
  ['AC', 'clear'],
  ['⌫', 'backspace'],
  ['%', '%'],
  ['÷', '÷'],
  ['7', '7'],
  ['8', '8'],
  ['9', '9'],
  ['×', '×'],
  ['4', '4'],
  ['5', '5'],
  ['6', '6'],
  ['−', '−'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['+', '+'],
  ['±', 'negate'],
  ['0', '0'],
  ['.', '.'],
  ['=', 'equals'],
]
const functions = [
  ['sin', 'sin('],
  ['cos', 'cos('],
  ['tan', 'tan('],
  ['x²', '^2'],
  ['√', 'sqrt('],
  ['ln', 'ln('],
  ['log', 'log('],
  ['xʸ', '^'],
  ['π', 'π'],
  ['e', 'e'],
  ['(', '('],
  [')', ')'],
  ['ANS', 'ANS'],
  ['n!', '!'],
  ['1/x', 'reciprocal'],
]
async function insert(value: string) {
  error.value = ''
  if (value === 'clear') {
    expression.value = ''
    completed.value = false
    return
  }
  if (value === 'equals') {
    run()
    return
  }
  if (value === 'backspace') {
    expression.value = expression.value.slice(0, -1)
    completed.value = false
    return
  }
  if (value === 'negate') {
    const base = completed.value ? ans.value : expression.value
    expression.value = base ? `-(${base})` : '-'
    completed.value = false
    return
  }
  if (value === 'reciprocal') {
    const base = completed.value ? ans.value : expression.value
    expression.value = base ? `1/(${base})` : '1/('
    completed.value = false
    return
  }
  const wasCompleted = completed.value
  if (wasCompleted) {
    expression.value = /^[+−×÷^%!]/.test(value) ? ans.value : ''
  }
  completed.value = false
  const start = wasCompleted
    ? expression.value.length
    : (input.value?.selectionStart ?? expression.value.length)
  const end = wasCompleted ? start : (input.value?.selectionEnd ?? start)
  const before = expression.value.slice(0, start)
  const after = expression.value.slice(end)
  if ((before + value + after).length > 2000) {
    return
  }
  expression.value = before + value + after
  await nextTick()
  input.value?.setSelectionRange(start + value.length, start + value.length)
}
function run() {
  error.value = ''
  try {
    const values = {
      expression: expression.value,
      angle: angle.value,
      ans: ans.value,
    }
    const request: CalculationInput = {
      kind: props.scientific ? 'scientific' : 'basic',
      values,
    }
    const result = calculate(request)
    emit('calculated', request, result)
    ans.value = result.items[0]!.value
    completedResult.value = result.items[0]!.value
    completed.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '计算失败'
  }
}
function typed() {
  completed.value = false
  error.value = ''
}
</script>

<template>
  <div class="calc-expression">
    <div class="calc-display">
      <div class="calc-display-meta">
        <span>{{ scientific ? "科学计算" : "基础计算" }}</span>
        <div
          v-if="scientific"
          class="calc-angle"
          aria-label="角度模式"
        >
          <button
            v-for="mode in ['deg', 'rad'] as const"
            :key="mode"
            :aria-pressed="angle === mode"
            @click="
              angle = mode;
              completed = false;
            "
          >
            {{ mode.toUpperCase() }}
          </button>
        </div>
        <span v-else>数学表达式</span>
      </div>
      <textarea
        ref="input"
        v-model="expression"
        aria-label="计算公式"
        placeholder="0"
        rows="2"
        maxlength="2000"
        spellcheck="false"
        autocapitalize="off"
        @input="typed"
        @keydown.enter.prevent="run"
      />
      <output
        class="calc-display-result"
        aria-live="polite"
      ><span>=</span><strong>{{ preview }}</strong></output>
    </div>
    <p
      v-if="error"
      class="calc-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div v-if="scientific" class="calc-function-keys">
      <button
        v-for="[label, value] in functions"
        :key="label"
        @click="insert(value!)"
      >
        {{ label }}
      </button>
    </div>
    <div v-else class="calc-basic-utilities">
      <button
        v-for="key in ['(', ')', 'ANS']"
        :key="key"
        @click="insert(key)"
      >
        {{ key }}
      </button>
    </div>
    <div class="calc-number-keys">
      <button
        v-for="[label, value] in keys"
        :key="value"
        :class="{
          operator: ['÷', '×', '−', '+'].includes(label!),
          equals: value === 'equals',
          clear: value === 'clear',
        }"
        :aria-label="
          value === 'backspace'
            ? '删除最后一位'
            : value === 'clear'
              ? '清空公式'
              : value === 'equals'
                ? '计算结果'
                : label
        "
        @click="insert(value!)"
      >
        <AppIcon
          v-if="value === 'backspace'"
          name="left"
          :size="21"
        /><template
          v-else
        >
          {{ label }}
        </template>
      </button>
    </div>
    <p class="calc-keyboard-hint">
      本地计算，不扣额度 · Enter 计算 · ANS 使用上次结果
    </p>
  </div>
</template>
