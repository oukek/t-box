<script setup lang="ts">
import type {
  Bill,
  LedgerAccount,
  LedgerBillDetail,
  LedgerRefund,
} from '@t-box/ledger-contracts'
import type { FormValues, LedgerFormField } from './form'
import { BottomSheet } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'
import { formatMoney, localDate } from '../bills/format'
import { featureApi, useFeatureAction } from './api'
import AttachmentButton from './AttachmentButton.vue'
import LedgerFormSheet from './LedgerFormSheet.vue'
import RecordAttachments from './RecordAttachments.vue'

const props = defineProps<{
  ledgerId: string
  billId: string | null
  canWrite: boolean
  categoryLabel: (id: string) => string
}>()
const emit = defineEmits<{ close: [], copy: [bill: Bill], changed: [] }>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const detail = ref<LedgerBillDetail>()
const accounts = ref<LedgerAccount[]>([])
const editor = ref<'refund' | 'reimburse' | 'template' | 'reverse' | null>(null)
const target = ref<LedgerRefund>()
const attachmentResourceIds = ref<string[]>([])
const form = ref<FormValues>({})
const fields = computed<LedgerFormField[]>(() =>
  editor.value === 'template'
    ? [{ key: 'name', label: '模板名称', required: true, max: 60 }]
    : editor.value === 'reimburse'
      ? [
          { key: 'counterparty', label: '报销方', required: true, max: 80 },
          { key: 'amount', label: '申请金额', kind: 'money', required: true },
        ]
      : editor.value === 'refund'
        ? [
            { key: 'amount', label: '退款金额', kind: 'money', required: true },
            { key: 'date', label: '退款日期', kind: 'date' },
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
          ]
        : [],
)
async function load() {
  if (!props.billId) {
    return
  }
  try {
    ;[detail.value, accounts.value] = await Promise.all([
      api.get<LedgerBillDetail>(`/bills/${props.billId}/detail`),
      api.get<LedgerAccount[]>('/accounts'),
    ])
  } catch (e) {
    action.error.value = (e as Error).message
  }
}
watch(
  () => props.billId,
  () => {
    detail.value = undefined
    action.error.value = ''
    void load()
  },
  { immediate: true },
)
function open(mode: typeof editor.value, row?: LedgerRefund) {
  const bill = detail.value?.bill
  if (!bill) {
    return
  }
  target.value = row
  attachmentResourceIds.value = []
  editor.value = mode
  action.error.value = ''
  form.value =
    mode === 'template'
      ? { name: props.categoryLabel(bill.category) }
      : mode === 'reimburse'
        ? { counterparty: '', amount: bill.amount }
        : {
            amount: '',
            date: localDate(),
            accountId: bill.accountId ?? '',
            note: '',
          }
}
async function save() {
  const bill = detail.value?.bill
  if (!bill || !editor.value || (editor.value === 'reverse' && !target.value)) {
    return
  }
  const targetId = target.value?.id
  const mode = editor.value
  const path =
    mode === 'refund'
      ? '/refunds'
      : mode === 'reimburse'
        ? '/reimbursements'
        : mode === 'template'
          ? '/templates'
          : `/refunds/${targetId}/reversal`
  const body =
    mode === 'refund'
      ? {
          billId: bill.id,
          attachmentResourceIds: attachmentResourceIds.value,
          ...form.value,
          accountId: form.value.accountId || null,
        }
      : mode === 'reimburse'
        ? {
            billId: bill.id,
            ...form.value,
            attachmentResourceIds: attachmentResourceIds.value,
          }
        : mode === 'template'
          ? {
              name: form.value.name,
              bill: {
                type: bill.type,
                amount: bill.amount,
                category: bill.category,
                date: localDate(),
                note: bill.note,
                accountId: bill.accountId ?? null,
              },
            }
          : {}
  const r = await action.run(path, body, (k) =>
    api.write(path, body, 'POST', k))
  if (r) {
    editor.value = null
    emit('changed')
    await load()
  }
}
const auditLabel = (action: string) =>
  (
    ({
      'bill.created': '创建账单',
      'bill.updated': '修改账单',
      'bill.restored': '恢复账单',
      'attachment.added': '添加附件',
      'refund.created': '登记退款',
      'refund.reversed': '撤销退款',
      'reimbursement.requested': '申请报销',
    }) as Record<string, string>
  )[action] ?? action
</script>

<template>
  <BottomSheet
    :open="!!billId"
    title="账单详情"
    full-height
    compact
    @close="emit('close')"
  >
    <template v-if="detail">
      <p class="feature-money">
        {{ detail.bill.type === "income" ? "+" : "−" }}
        {{ formatMoney(detail.bill.amount) }} 元
      </p>
      <dl class="feature-detail-grid">
        <div>
          <dt>分类</dt>
          <dd>{{ categoryLabel(detail.bill.category) }}</dd>
        </div>
        <div>
          <dt>日期</dt>
          <dd>{{ detail.bill.date }}</dd>
        </div>
        <div>
          <dt>记录人</dt>
          <dd>{{ detail.creator }}</dd>
        </div>
        <div>
          <dt>资金账户</dt>
          <dd>
            {{
              accounts.find((a) => a.id === detail?.bill.accountId)?.name
                ?? "未指定"
            }}
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{{ new Date(detail.bill.createdAt).toLocaleString() }}</dd>
        </div>
        <div>
          <dt>修改时间</dt>
          <dd>{{ new Date(detail.bill.updatedAt).toLocaleString() }}</dd>
        </div>
      </dl>
      <p class="feature-hint">
        {{ detail.bill.note || "没有备注" }}
      </p>
      <div v-if="canWrite" class="feature-actions">
        <template v-if="detail.bill.type === 'expense'">
          <button @click="open('refund')">登记退款</button><button @click="open('reimburse')">申请报销</button>
        </template><button @click="open('template')">存为模板</button>
      </div>
      <h3 class="feature-section-title">退款与报销</h3>
      <div
        v-for="row in detail.refunds"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>退款 {{ row.amount }} 元{{
            Number(row.reversed) ? " · 已撤销" : ""
          }}</strong><small>{{ row.date }} · {{ row.note }}</small>
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="refund"
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
      <div
        v-for="row in detail.reimbursements"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.counterparty }} · 报销 {{ row.amount }} 元</strong><small>已到账 {{ row.received }} 元</small>
        </div>
        <AttachmentButton
          :ledger-id="ledgerId"
          kind="reimbursement"
          :record-id="row.id"
          :can-write="canWrite"
        />
      </div>
      <p
        v-if="!detail.refunds.length && !detail.reimbursements.length"
        class="feature-hint"
      >
        暂无关联记录
      </p>
      <RecordAttachments
        :key="detail.bill.id"
        :ledger-id="ledgerId"
        kind="bill"
        :record-id="detail.bill.id"
        :can-write="canWrite"
      />
      <h3 class="feature-section-title">操作记录</h3>
      <div
        v-for="row in detail.history"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.actor || "系统" }} · {{ auditLabel(row.action) }}</strong><small>{{ new Date(row.createdAt).toLocaleString() }}</small>
        </div>
      </div>
    </template>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        @click="emit('close')"
      > 关闭</button><button
        v-if="detail && canWrite"
        type="button"
        class="button button-primary"
        @click="emit('copy', detail.bill)"
      >
        再记一笔
      </button>
    </template>
  </BottomSheet><LedgerFormSheet
    v-model="form"
    v-model:attachment-resource-ids="attachmentResourceIds"
    :ledger-id="ledgerId"
    :attachments="editor === 'refund' || editor === 'reimburse'"
    :open="!!editor"
    :title="
      editor === 'refund'
        ? '登记退款'
        : editor === 'reimburse'
          ? '申请报销'
          : editor === 'template'
            ? '保存常用模板'
            : '撤销退款'
    "
    :fields="fields"
    :busy="action.busy.value"
    :error="action.error.value"
    :description="
      editor === 'refund'
        ? '退款减少净支出，不作为收入；退款与报销申请合计不能超过原支出。'
        : undefined
    "
    @close="editor = null"
    @submit="save"
  />
</template>
