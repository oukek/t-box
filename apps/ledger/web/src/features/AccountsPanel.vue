<script setup lang="ts">
import type {
  LedgerAccount,
  LedgerAccountEntry,
  LedgerTransfer,
} from '@t-box/ledger-contracts'
import type { FormValues, LedgerFormField } from './form'
import { BottomSheet } from '@t-box/ui-kit'
import { computed, onMounted, ref } from 'vue'
import { formatMoney, localDate } from '../bills/format'
import { featureApi, useFeatureAction } from './api'
import AttachmentButton from './AttachmentButton.vue'
import LedgerFormSheet from './LedgerFormSheet.vue'

const props = defineProps<{
  ledgerId: string
  canWrite: boolean
  canManage: boolean
}>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const rows = ref<LedgerAccount[]>([])
const transfers = ref<LedgerTransfer[]>([])
const entries = ref<LedgerAccountEntry[]>([])
const entryOpen = ref(false)
const editor = ref<
  'create' | 'edit' | 'reconcile' | 'transfer' | 'reverse' | null
>(null)
const target = ref<{ id: string, name?: string }>()
const attachmentResourceIds = ref<string[]>([])
const form = ref<FormValues>({})
const accountOptions = computed(() =>
  rows.value
    .filter((r) => !r.archived)
    .map((r) => ({ value: r.id, label: r.name })),
)
const fields = computed<LedgerFormField[]>(() =>
  editor.value === 'create'
    ? [
        { key: 'name', label: '账户名称', required: true, max: 60 },
        {
          key: 'kind',
          label: '类型',
          kind: 'select',
          options: [
            { value: 'cash', label: '现金' },
            { value: 'bank', label: '银行卡' },
            { value: 'wallet', label: '微信 / 支付宝' },
            { value: 'other', label: '其他' },
          ],
        },
        {
          key: 'openingBalance',
          label: '期初余额',
          kind: 'money',
          required: true,
        },
        { key: 'date', label: '期初日期', kind: 'date' },
      ]
    : editor.value === 'edit'
      ? [
          { key: 'name', label: '账户名称', required: true },
          {
            key: 'archived',
            label: '归档（停止新记录，历史保留）',
            kind: 'checkbox',
          },
        ]
      : editor.value === 'reconcile'
        ? [
            {
              key: 'balance',
              label: '实际余额',
              kind: 'money',
              required: true,
            },
            { key: 'date', label: '核对日期', kind: 'date' },
            { key: 'note', label: '调整原因', required: true },
          ]
        : editor.value === 'transfer'
          ? [
              {
                key: 'fromAccountId',
                label: '转出账户',
                kind: 'select',
                options: accountOptions.value,
              },
              {
                key: 'toAccountId',
                label: '转入账户',
                kind: 'select',
                options: accountOptions.value,
              },
              { key: 'amount', label: '金额', kind: 'money', required: true },
              { key: 'date', label: '日期', kind: 'date' },
              { key: 'note', label: '备注' },
            ]
          : [],
)
async function load() {
  ;[rows.value, transfers.value] = await Promise.all([
    api.get<LedgerAccount[]>('/accounts'),
    api.get<LedgerTransfer[]>('/transfers'),
  ])
}
function open(mode: typeof editor.value, row?: LedgerAccount | LedgerTransfer) {
  target.value = row
  attachmentResourceIds.value = []
  editor.value = mode
  action.error.value = ''
  if (mode === 'edit' || mode === 'reconcile') {
    if (!row || !('balance' in row)) {
      return
    }
    form.value =
      mode === 'edit'
        ? { name: row.name, archived: row.archived }
        : { balance: row.balance, date: localDate(), note: '' }
  } else if (mode === 'create') {
    form.value = {
      name: '',
      kind: 'cash',
      openingBalance: '0',
      date: localDate(),
    }
  } else if (mode === 'transfer') {
    form.value = {
      fromAccountId: accountOptions.value[0]?.value ?? '',
      toAccountId: accountOptions.value[1]?.value ?? '',
      amount: '',
      date: localDate(),
      note: '',
    }
  } else {
    form.value = {}
  }
}
async function save() {
  const mode = editor.value
  if (
    !mode ||
    ((mode === 'edit' || mode === 'reconcile' || mode === 'reverse') &&
      !target.value)
  ) {
    return
  }
  const targetId = target.value?.id
  const path =
    mode === 'create'
      ? '/accounts'
      : mode === 'edit'
        ? `/accounts/${targetId}`
        : mode === 'reconcile'
          ? `/accounts/${targetId}/reconcile`
          : mode === 'reverse'
            ? `/transfers/${targetId}/reversal`
            : '/transfers'
  const body =
    mode === 'transfer'
      ? { ...form.value, attachmentResourceIds: attachmentResourceIds.value }
      : form.value
  const result = await action.run(path, body, (k) =>
    api.write(path, body, mode === 'edit' ? 'PATCH' : 'POST', k))
  if (result) {
    editor.value = null
    await load()
  }
}
async function show(row: LedgerAccount) {
  target.value = row
  try {
    entries.value = await api.get<LedgerAccountEntry[]>(
      `/accounts/${row.id}/entries`,
    )
    entryOpen.value = true
  } catch (e) {
    action.error.value = (e as Error).message
  }
}
onMounted(() => load().catch((e) => (action.error.value = e.message)))
</script>

<template>
  <div>
    <div class="feature-toolbar">
      <h2>资金账户</h2>
      <div class="feature-inline">
        <button
          v-if="canWrite"
          class="button button-secondary"
          @click="open('transfer')"
        > 转账</button><button
          v-if="canManage"
          class="button button-primary"
          @click="open('create')"
        >
          添加账户
        </button>
      </div>
    </div>
    <p class="feature-hint">
      这里只记录资金，不进行真实支付。账户余额与账本收支结余不同，期初和余额核对不计入收入支出。
    </p>
    <div class="feature-card">
      <div
        v-for="row in rows"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.name }}{{ row.archived ? " · 已归档" : "" }}</strong><small class="feature-money">¥ {{ formatMoney(row.balance) }}</small>
        </div>
        <div class="feature-actions">
          <button @click="show(row)">流水</button><template v-if="canManage">
            <button @click="open('edit', row)">编辑</button><button v-if="!row.archived" @click="open('reconcile', row)">
              核对
            </button>
          </template>
        </div>
      </div>
      <p v-if="!rows.length" class="feature-empty">
        添加现金、银行卡或电子钱包账户。
      </p>
    </div>
    <h3 class="feature-section-title">账户转账</h3>
    <div class="feature-card">
      <div
        v-for="row in transfers"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ rows.find((a) => a.id === row.fromAccountId)?.name }} →
            {{ rows.find((a) => a.id === row.toAccountId)?.name }}</strong><small>{{ row.date }} · ¥ {{ row.amount
          }}{{ Number(row.reversed) ? " · 已撤销" : "" }}</small>
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="transfer"
            :record-id="row.id"
            :can-write="canWrite"
          />
          <button
            v-if="canWrite && !Number(row.reversed)"
            @click="open('reverse', row)"
          >
            撤销
          </button>
        </div>
      </div>
      <p v-if="!transfers.length" class="feature-empty">没有转账记录。</p>
    </div>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <LedgerFormSheet
      v-model="form"
      v-model:attachment-resource-ids="attachmentResourceIds"
      :ledger-id="ledgerId"
      :attachments="editor === 'transfer'"
      :open="!!editor"
      :title="
        editor === 'create'
          ? '添加账户'
          : editor === 'edit'
            ? '编辑账户'
            : editor === 'reconcile'
              ? '核对账户余额'
              : editor === 'reverse'
                ? '撤销转账'
                : '账户转账'
      "
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="
        editor === 'reverse'
          ? '撤销后将修正两个账户的余额，保留原始流水。'
          : undefined
      "
      @close="editor = null"
      @submit="save"
    /><BottomSheet
      :open="entryOpen"
      :title="`${target?.name ?? ''} · 资金流水`"
      full-height
      compact
      @close="entryOpen = false"
    >
      <div
        v-for="row in entries"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.note || "资金记录" }}</strong><small>{{ row.date }}</small>
        </div>
        <div>
          <span>{{ row.amount }} 元</span><AttachmentButton
            :ledger-id="ledgerId"
            kind="account-entry"
            :record-id="row.id"
            :can-write="canManage"
          />
        </div>
      </div>
      <p v-if="!entries.length" class="feature-empty">暂无流水</p>
    </BottomSheet>
  </div>
</template>
