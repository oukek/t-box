<script setup lang="ts">
import type { LedgerAccount } from '@t-box/ledger-contracts'
import type { FormValues, LedgerFormField } from './form'
import { BottomSheet } from '@t-box/ui-kit'
import { computed, onMounted, ref } from 'vue'
import { localDate } from '../bills/format'
import { featureApi, useFeatureAction } from './api'
import AttachmentButton from './AttachmentButton.vue'
import LedgerFormSheet from './LedgerFormSheet.vue'

const props = defineProps<{ ledgerId: string, canWrite: boolean }>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const rows = ref<any[]>([])
const accounts = ref<LedgerAccount[]>([])
const target = ref<any>()
const historyTarget = ref<any>()
const receipts = ref<any[]>([])
const operation = ref<{ path: string, title: string } | null>(null)
const attachmentResourceIds = ref<string[]>([])
const form = ref<FormValues>({})
const fields = computed<LedgerFormField[]>(() => [
  { key: 'amount', label: '本次到账金额', kind: 'money', required: true },
  { key: 'date', label: '到账日期', kind: 'date' },
  {
    key: 'accountId',
    label: '收款账户',
    kind: 'select',
    options: [
      { value: '', label: '不指定账户' },
      ...accounts.value
        .filter((a) => !a.archived)
        .map((a) => ({ value: a.id, label: a.name })),
    ],
  },
  { key: 'note', label: '备注' },
])
async function load() {
  [rows.value, accounts.value] = await Promise.all([
    api.get('/reimbursements'),
    api.get('/accounts'),
  ])
}
function open(row: any) {
  attachmentResourceIds.value = []
  target.value = row
  form.value = {
    amount: (Number(row.amount) - Number(row.received)).toFixed(2),
    date: localDate(),
    accountId: '',
    note: '',
  }
  action.error.value = ''
}
async function save() {
  const body = {
    ...form.value,
    attachmentResourceIds: attachmentResourceIds.value,
    accountId: form.value.accountId || null,
  }
  const path = `/reimbursements/${target.value.id}/receipts`
  const r = await action.run(path, body, (k) =>
    api.write(path, body, 'POST', k))
  if (r) {
    target.value = undefined
    await load()
  }
}
async function history(row: any) {
  historyTarget.value = row
  try {
    receipts.value = await api.get(`/reimbursements/${row.id}/receipts`)
  } catch (e) {
    action.error.value = (e as Error).message
  }
}
async function confirmOperation() {
  if (!operation.value) {
    return
  }
  const path = operation.value.path
  const result = await action.run(path, {}, (k) =>
    api.write(path, {}, 'POST', k))
  if (result) {
    operation.value = null
    await load()
    if (historyTarget.value) {
      const row = rows.value.find((r) => r.id === historyTarget.value.id)
      if (row) {
        await history(row)
      }
    }
  }
}
onMounted(() => load().catch((e) => (action.error.value = e.message)))
</script>

<template>
  <div>
    <h2 class="feature-section-title">报销记录</h2>
    <p class="feature-hint">
      在账单详情中申请报销。申请计入应收，到账减少应收及净支出，不计入普通收入。
    </p>
    <div class="feature-card">
      <div
        v-for="row in rows"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.counterparty }} · {{ row.amount }} 元</strong><small>已到账 {{ row.received
          }}<template v-if="row.status === 'cancelled'">
            · 已取消，不再计入应收</template><template v-else>
            · 未到账
            {{ (Number(row.amount) - Number(row.received)).toFixed(2) }}
            元</template></small>
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="reimbursement"
            :record-id="row.id"
            :can-write="canWrite"
          />
          <button @click="history(row)">明细</button><button
            v-if="
              canWrite
                && row.status !== 'cancelled'
                && Number(row.received) < Number(row.amount)
            "
            @click="open(row)"
          > 登记到账</button><button
            v-if="
              canWrite && row.status !== 'cancelled' && !Number(row.received)
            "
            @click="
              operation = {
                path: `/reimbursements/${row.id}/cancel`,
                title: '取消报销申请',
              }
            "
          >
            取消申请
          </button>
        </div>
      </div>
      <p v-if="!rows.length" class="feature-empty">暂无报销申请。</p>
    </div>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <LedgerFormSheet
      v-model="form"
      v-model:attachment-resource-ids="attachmentResourceIds"
      :ledger-id="ledgerId"
      attachments
      :open="!!target"
      title="报销到账"
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      @close="target = undefined"
      @submit="save"
    />
    <BottomSheet
      :open="!!historyTarget"
      title="报销到账记录"
      full-height
      compact
      @close="historyTarget = undefined"
    >
      <div
        v-for="r in receipts"
        :key="r.id"
        class="feature-row"
      >
        <div>
          <strong>{{ r.amount }} 元{{
            Number(r.reversed) ? " · 已撤销" : ""
          }}</strong><small>{{ r.date }} · {{ r.note || "无备注" }}</small>
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="reimbursement-receipt"
            :record-id="r.id"
            :can-write="canWrite"
          />
          <button
            v-if="canWrite && !Number(r.reversed)"
            @click="
              operation = {
                path: `/reimbursement-receipts/${r.id}/reversal`,
                title: '撤销报销到账',
              }
            "
          >
            撤销误记
          </button>
        </div>
      </div>
      <p v-if="!receipts.length" class="feature-empty">暂无到账记录。</p>
      <p v-if="action.error.value" class="form-error">
        {{ action.error.value }}
      </p>
    </BottomSheet>
    <LedgerFormSheet
      v-model="form"
      :open="!!operation"
      :title="operation?.title ?? ''"
      :fields="[]"
      :busy="action.busy.value"
      :error="action.error.value"
      description="用于纠正误记；关联应收、净支出和账户余额会同步修正，不产生实际付款。"
      @close="operation = null"
      @submit="confirmOperation"
    />
  </div>
</template>
