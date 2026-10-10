<script setup lang="ts">
import type { BillCategory, LedgerBudget } from '@t-box/ledger-contracts'
import type { FormValues, LedgerFormField } from './form'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { localDate } from '../bills/format'
import { featureApi, useFeatureAction } from './api'
import LedgerFormSheet from './LedgerFormSheet.vue'

const props = defineProps<{ ledgerId: string, canManage: boolean }>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const month = ref(localDate().slice(0, 7))
const rows = ref<LedgerBudget[]>([])
const categories = ref<BillCategory[]>([])
const editor = ref(false)
const removeId = ref('')
const form = ref<FormValues>({})
const fields = computed<LedgerFormField[]>(() =>
  removeId.value
    ? []
    : [
        { key: 'month', label: '预算月份', kind: 'month' },
        {
          key: 'categoryId',
          label: '预算范围',
          kind: 'select',
          options: [
            { value: '', label: '整个账本' },
            ...categories.value
              .filter((r) => r.type === 'expense' && r.active !== false)
              .map((r) => ({ value: r.id, label: r.label })),
          ],
        },
        { key: 'amount', label: '预算金额', kind: 'money', required: true },
      ],
)
async function load() {
  rows.value = await api.get(`/budgets?month=${month.value}`)
}
function open(row?: LedgerBudget) {
  removeId.value = ''
  form.value = {
    month: month.value,
    categoryId: row?.categoryId ?? '',
    amount: row?.amount ?? '',
  }
  action.error.value = ''
  editor.value = true
}
async function save() {
  const body = removeId.value
    ? {}
    : { ...form.value, categoryId: form.value.categoryId || null }
  const path = removeId.value ? `/budgets/${removeId.value}` : '/budgets'
  const result = await action.run(path, body, (k) =>
    api.write(path, body, removeId.value ? 'DELETE' : 'POST', k))
  if (result) {
    editor.value = false
    await load()
  }
}
watch(month, () => load().catch((e) => (action.error.value = e.message)))
onMounted(async () => {
  try {
    categories.value = await api.get('/categories')
    await load()
  } catch (e) {
    action.error.value = (e as Error).message
  }
})
</script>

<template>
  <div>
    <div class="feature-toolbar">
      <h2>月度预算</h2>
      <button
        v-if="canManage"
        class="button button-primary"
        @click="open()"
      >
        设置预算
      </button>
    </div>
    <DateSheetField
      v-model="month"
      mode="month"
      label="选择预算月份"
      compact
    />
    <p class="feature-hint">
      共享账本使用共同预算；退款和报销到账减少净支出。到达 80%
      和超支时生成账本提醒。
    </p>
    <div
      v-for="row in rows"
      :key="row.id"
      class="feature-card"
    >
      <div class="feature-row">
        <div>
          <strong>{{
            row.categoryId
              ? categories.find((c) => c.id === row.categoryId)?.label
              : "账本总预算"
          }}</strong><small>净支出 {{ row.spent }} / 预算 {{ row.amount }} 元</small>
        </div>
        <div v-if="canManage" class="feature-actions">
          <button @click="open(row)">修改</button><button
            @click="
              removeId = row.id;
              form = {};
              editor = true;
            "
          >
            移除
          </button>
        </div>
      </div>
      <div class="feature-progress" :class="{ over: row.ratio > 1 }">
        <span :style="{ width: `${Math.min(100, row.ratio * 100)}%` }" />
      </div>
      <p class="feature-hint">
        {{ Number(row.remaining) < 0 ? "已超支" : "剩余" }}
        {{ Math.abs(Number(row.remaining)).toFixed(2) }} 元 · 已用
        {{ (row.ratio * 100).toFixed(0) }}%
      </p>
    </div>
    <p v-if="!rows.length" class="feature-empty">这个月还没有预算。</p>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <LedgerFormSheet
      v-model="form"
      :open="editor"
      :title="removeId ? '移除预算' : '设置预算'"
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="removeId ? '移除预算不影响账单记录。' : undefined"
      @close="editor = false"
      @submit="save"
    />
  </div>
</template>
