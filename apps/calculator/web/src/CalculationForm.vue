<script setup lang="ts">
import type { CalculationInput, CalculationResult, CalculatorDefinition } from '@t-box/calculator-contracts'
import {
  calculate,
  calculatorDefaults,
  fieldVisible,
} from '@t-box/calculator-contracts'
import { SheetSelect } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  definition: CalculatorDefinition
  initialValues?: Record<string, string | null>
  revision: number
}>()
const emit = defineEmits<{
  calculated: [input: CalculationInput, result: CalculationResult]
}>()
const values = ref<Record<string, string>>({})
const result = ref<CalculationResult | null>(null)
const error = ref('')
watch(
  () => [props.definition.id, props.revision],
  () => {
    values.value = {
      ...calculatorDefaults(props.definition.id),
      ...Object.fromEntries(
        Object.entries(props.initialValues ?? {}).filter(
          ([, v]) => typeof v === 'string',
        ),
      ),
    } as Record<string, string>
    result.value = null
    error.value = ''
  },
  { immediate: true },
)
watch(
  values,
  () => {
    result.value = null
    error.value = ''
  },
  { deep: true },
)
const fields = computed(() =>
  props.definition.fields.filter((field) => fieldVisible(field, values.value)),
)
function run() {
  error.value = ''
  try {
    const input: CalculationInput = {
      kind: props.definition.id,
      values: { ...values.value },
    }
    result.value = calculate(input)
    emit('calculated', input, result.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '计算失败'
  }
}
</script>

<template>
  <form class="calc-form" @submit.prevent="run">
    <div class="calc-field-grid">
      <label
        v-for="field in fields"
        :key="field.key"
        :for="`calc-${field.key}`"
        :class="{
          wide:
            field.type === 'textarea'
            || definition.id === 'vector'
            || definition.id === 'polynomial',
        }"
      ><span>{{ field.label }}</span><SheetSelect
        v-if="field.type === 'select'"
        v-model="values[field.key]!"
        :label="field.label"
        :options="field.options!"
      /><textarea
        v-else-if="field.type === 'textarea'"
        :id="`calc-${field.key}`"
        v-model="values[field.key]"
        :aria-label="field.label"
        rows="4"
        maxlength="16000"
        spellcheck="false"
      /><input
        v-else
        :id="`calc-${field.key}`"
        v-model="values[field.key]"
        :aria-label="field.label"
        :inputmode="field.type === 'number' ? 'decimal' : 'text'"
        type="text"
        maxlength="2000"
        :placeholder="field.placeholder"
        autocomplete="off"
        spellcheck="false"
      ></label>
    </div>
    <p
      v-if="error"
      class="calc-error"
      role="alert"
    >
      {{ error }}
    </p>
    <button class="calc-run" type="submit">计算</button>
    <section
      v-if="result"
      class="calc-result-list"
      aria-label="计算结果"
      aria-live="polite"
    >
      <div v-for="item in result.items" :key="item.label">
        <span>{{ item.label }}</span><output>{{ item.value
        }}<small v-if="item.unit"> {{ item.unit }}</small></output>
      </div>
    </section>
  </form>
</template>
