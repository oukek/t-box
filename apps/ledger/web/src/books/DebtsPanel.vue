<script setup lang="ts">
import type {
  Debt,
  LedgerAccount,
  LedgerContact,
  Settlement,
} from '@t-box/ledger-contracts'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { formatMoney, localDate, normalizeAmount } from '../bills/format'
import { ErrorCode } from '../error-codes.js'
import { featureApi } from '../features/api'
import AttachmentButton from '../features/AttachmentButton.vue'
import AttachmentPicker from '../features/AttachmentPicker.vue'
import { createRequestId, identity } from '../runtime'
import { booksApi } from './booksApi'
import { bookState, invalidateBook } from './bookStore'

const props = defineProps<{
  ledgerId: string
  canWrite: boolean
  canManage: boolean
}>()
const attachmentResourceIds = ref<string[]>([])
const uploadingAttachments = ref(false)
const accounts = ref<LedgerAccount[]>([])
const contacts = ref<LedgerContact[]>([])
const settleAccount = ref('')
const debts = ref<Debt[]>([])
const settlements = ref<Settlement[]>([])
const filter = ref<'all' | 'receivable' | 'payable'>('all')
const status = ref<'open' | 'all'>('open')
const error = ref('')
const loading = ref(false)
const busy = ref(false)
const modal = ref<'create' | 'settle' | 'reverse' | null>(null)
const formError = ref('')
const form = reactive({
  direction: 'receivable' as 'receivable' | 'payable',
  counterparty: '',
  contactId: '',
  accountId: '',
  amount: '',
  date: localDate(),
  dueDate: '',
  note: '',
  cashMovement: true,
})
const target = ref<Debt>()
const reverseTarget = ref<Settlement>()
const settleDate = ref(localDate())
const settleNote = ref('')
const allocations = reactive<Record<string, string>>({})
let key = createRequestId()
let generation = 0
const page = ref(1)
const total = ref(0)
const receivable = ref('0.00')
const payable = ref('0.00')
const candidateRows = ref<Debt[]>([])
const visible = computed(() =>
  debts.value.filter(
    (row) =>
      (filter.value === 'all' || row.direction === filter.value) &&
      (status.value === 'all' || row.status === 'open'),
  ),
)
const candidates = computed(() => candidateRows.value)
const totalAmount = computed(() => {
  let total = 0n
  for (const amount of Object.values(allocations)) {
    const normalized = normalizeAmount(amount)
    if (normalized) {
      const [whole, fraction] = normalized.split('.')
      total += BigInt(whole!) * 100n + BigInt(fraction!)
    }
  }
  return `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`
})
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams({
      page: String(page.value),
      pageSize: '20',
      ...(filter.value !== 'all' ? { direction: filter.value } : {}),
      ...(status.value === 'open' ? { status: 'open' } : {}),
    })
    const [a, b, c, d, e] = await Promise.all([
      booksApi.debts(props.ledgerId, query),
      booksApi.settlements(props.ledgerId),
      booksApi.statistics(props.ledgerId, 'month', localDate().slice(0, 7)),
      featureApi(props.ledgerId).get<LedgerAccount[]>('/accounts'),
      featureApi(props.ledgerId).get<LedgerContact[]>('/contacts'),
    ])
    if (current === generation) {
      accounts.value = d
      contacts.value = e
      debts.value = a.data
      total.value = a.meta.total
      settlements.value = b.data
      receivable.value = c.data.currentReceivable
      payable.value = c.data.currentPayable
    }
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : '往来读取失败'
    }
  } finally {
    if (current === generation) {
      loading.value = false
    }
  }
}
function create() {
  attachmentResourceIds.value = []
  Object.assign(form, {
    direction: 'receivable',
    counterparty: '',
    contactId: '',
    accountId: '',
    amount: '',
    date: localDate(),
    dueDate: '',
    note: '',
    cashMovement: true,
  })
  key = createRequestId()
  formError.value = ''
  modal.value = 'create'
}
async function settle(row: Debt) {
  attachmentResourceIds.value = []
  target.value = row
  candidateRows.value = [row]
  for (const id of Object.keys(allocations)) {
    delete allocations[id]
  }
  allocations[row.id] = row.remaining
  settleDate.value = localDate()
  settleNote.value = ''
  settleAccount.value = ''
  key = createRequestId()
  formError.value = ''
  modal.value = 'settle'
  try {
    const result = await booksApi.debts(
      props.ledgerId,
      new URLSearchParams({
        direction: row.direction,
        counterparty: row.counterparty,
        status: 'open',
        pageSize: '100',
      }),
    )
    if (target.value?.id === row.id) {
      candidateRows.value = result.data.some((item) => item.id === row.id)
        ? result.data
        : [row, ...result.data]
    }
  } catch {
    formError.value = '其他往来未能读取，仍可以结算当前这一笔'
  }
}
function changeAllocation(row: Debt, event: Event) {
  if ((event.target as HTMLInputElement).checked) {
    allocations[row.id] = row.remaining
  } else {
    delete allocations[row.id]
  }
}
function reverse(row: Settlement) {
  reverseTarget.value = row
  formError.value = ''
  modal.value = 'reverse'
}
async function save() {
  if (busy.value || uploadingAttachments.value) {
    return
  }
  busy.value = true
  formError.value = ''
  try {
    if (modal.value === 'create') {
      const amount = normalizeAmount(form.amount)
      if (!amount) {
        throw ErrorCode.INTERNAL_INVALID_AMOUNT()
      }
      await booksApi.debt(
        props.ledgerId,
        {
          ...form,
          attachmentResourceIds: attachmentResourceIds.value,
          amount,
          dueDate: form.dueDate || null,
          contactId: form.contactId || null,
          counterparty:
            contacts.value.find((c) => c.id === form.contactId)?.name ??
            form.counterparty,
          accountId: form.cashMovement ? form.accountId || null : null,
        },
        key,
      )
    } else if (modal.value === 'settle') {
      const rows = Object.entries(allocations).map(([debtId, value]) => {
        const amount = normalizeAmount(value)
        if (!amount) {
          throw ErrorCode.INTERNAL_INVALID_ALLOCATION_AMOUNT()
        }
        return { debtId, amount }
      })
      if (!rows.length) {
        throw ErrorCode.INTERNAL_DEBT_SELECTION_REQUIRED()
      }
      await booksApi.settle(
        props.ledgerId,
        {
          attachmentResourceIds: attachmentResourceIds.value,
          date: settleDate.value,
          note: settleNote.value,
          allocations: rows,
          accountId: settleAccount.value || null,
        },
        key,
      )
    } else if (reverseTarget.value) {
      await booksApi.reverse(props.ledgerId, reverseTarget.value.id)
    }
    modal.value = null
    invalidateBook(props.ledgerId)
    await load()
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    busy.value = false
  }
}
watch([filter, status], () => (page.value = 1), { flush: 'sync' })
watch(
  [() => props.ledgerId, () => bookState.revision, filter, status, page],
  load,
  { immediate: true },
)
onBeforeUnmount(() => generation++)
</script>

<template>
  <section class="book-panel">
    <header class="book-section-heading">
      <div>
        <h2>往来记录</h2>
      </div>
      <button
        v-if="canWrite"
        class="button button-primary"
        @click="create"
      >
        ＋ 新增往来
      </button>
    </header>
    <div class="book-metrics two">
      <article>
        <span>剩余应收</span><strong class="income">¥ {{ formatMoney(receivable) }}</strong><small>含往来与待报销</small>
      </article>
      <article>
        <span>剩余应付</span><strong>¥ {{ formatMoney(payable) }}</strong><small>账本欠别人</small>
      </article>
    </div>
    <div class="book-toolbar">
      <div class="segmented-control">
        <button
          v-for="item in [
            { id: 'all', label: '全部' },
            { id: 'receivable', label: '应收' },
            { id: 'payable', label: '应付' },
          ]"
          :key="item.id"
          :class="{ active: filter === item.id }"
          @click="filter = item.id as typeof filter"
        >
          {{ item.label }}
        </button>
      </div>
      <label>显示<SheetSelect
        v-model="status"
        label="往来显示范围"
        :options="[
          { value: 'open', label: '未结清' },
          { value: 'all', label: '全部往来' },
        ]"
      /></label>
    </div>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }} <button class="text-button" @click="load">重试</button>
    </p>
    <p v-if="loading">正在读取往来…</p>
    <template v-else-if="!error">
      <article
        v-for="debt in visible"
        :key="debt.id"
        class="debt-row"
      >
        <div class="debt-identity">
          <span class="direction-tag" :class="debt.direction">{{
            debt.direction === "receivable" ? "应收" : "应付"
          }}</span>
          <h3>{{ debt.counterparty }}</h3>
          <time>{{ debt.date }}
            <span v-if="debt.dueDate">· 到期 {{ debt.dueDate }}</span></time>
          <p>
            {{ debt.note || "无备注" }}
            <small>· {{ debt.cashMovement ? "有资金流" : "补录往来" }}</small>
          </p>
        </div>
        <div class="debt-amount">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="debt"
            :record-id="debt.id"
            :can-write="canWrite"
          />
          <span>剩余</span><strong>¥ {{ formatMoney(debt.remaining) }}</strong><small>原金额 {{ formatMoney(debt.amount) }} · 已{{
            debt.direction === "receivable" ? "收" : "还"
          }}
            {{ formatMoney(debt.settled)
            }}<template v-if="Number(debt.adjusted)">
              · 减免/核销 {{ formatMoney(debt.adjusted!) }}</template></small><button
            v-if="canWrite && debt.status === 'open'"
            class="button button-secondary"
            @click="settle(debt)"
          >
            {{
              debt.direction === "receivable" ? "登记收款" : "登记还款"
            }}
          </button><span
            v-else-if="debt.status === 'settled'"
            class="settled-label"
          >已结清</span>
        </div>
      </article>
      <p v-if="!visible.length" class="book-empty">
        还没有{{
          status === "open" ? "未结清的" : ""
        }}往来记录。借出、借入或补录一笔，从这里开始。
      </p>
      <footer v-if="total > 20" class="pagination">
        <span>共 {{ total }} 笔 · 第 {{ page }} 页</span>
        <div>
          <button
            class="button button-secondary"
            :disabled="page === 1 || loading"
            @click="page--"
          > 上一页</button><button
            class="button button-secondary"
            :disabled="page * 20 >= total || loading"
            @click="page++"
          >
            下一页
          </button>
        </div>
      </footer>
      <section class="settlement-history">
        <h3>收还款记录 <small class="muted">最近 500 笔</small></h3>
        <article
          v-for="row in settlements"
          :key="row.id"
          class="event-row"
        >
          <div>
            <b>{{ row.direction === "receivable" ? "收款" : "还款" }} ·
              {{ row.counterparty }}</b><time>{{ row.date }} · 关联 {{ row.allocations.length }} 笔</time>
            <p>{{ row.note || "无备注" }}</p>
          </div>
          <div class="event-amounts">
            <AttachmentButton
              :ledger-id="ledgerId"
              kind="settlement"
              :record-id="row.id"
              :can-write="
                canWrite && (canManage || row.createdBy === identity.user?.id)
              "
            />
            <strong>¥ {{ formatMoney(row.amount) }}</strong><span v-if="row.reversed">已撤销</span><button
              v-else-if="
                canWrite && (canManage || row.createdBy === identity.user?.id)
              "
              class="text-button"
              @click="reverse(row)"
            >
              撤销误记
            </button>
          </div>
        </article>
        <p v-if="!settlements.length" class="muted">还没有收还款记录。</p>
      </section>
    </template>
  </section>
  <BottomSheet
    :open="modal !== null"
    :title="
      modal === 'create'
        ? '新增往来'
        : modal === 'settle'
          ? target?.direction === 'receivable'
            ? '登记收款'
            : '登记还款'
          : '撤销这笔收还款？'
    "
    :busy="busy || uploadingAttachments"
    :full-height="modal !== 'reverse'"
    compact
    @close="modal = null"
  >
    <form id="ledger-debt-form" @submit.prevent="save">
      <fieldset class="form-fields" :disabled="busy || uploadingAttachments">
        <legend class="sr-only">往来详情</legend>
        <template v-if="modal === 'create'">
          <label class="form-field">方向<SheetSelect
            v-model="form.direction"
            label="往来方向"
            :disabled="busy || uploadingAttachments"
            :options="[
              {
                value: 'receivable',
                label: '应收',
                description: '别人欠账本',
              },
              { value: 'payable', label: '应付', description: '账本欠别人' },
            ]"
          /></label><label class="form-field">选择已有对象<SheetSelect
            v-model="form.contactId"
            label="选择往来对象"
            :options="[
              { value: '', label: '手动填写' },
              ...contacts
                .filter((c) => !Number(c.archived))
                .map((c) => ({ value: c.id, label: c.name })),
            ]"
          /></label><label
            v-if="!form.contactId"
            class="form-field"
          >往来对象<input
            v-model="form.counterparty"
            required
            maxlength="80"
            placeholder="姓名或公司，不必是账本成员"
          ></label><label class="form-field">金额<input
            v-model="form.amount"
            inputmode="decimal"
            required
            maxlength="12"
            placeholder="0.00"
          ></label><label class="form-field">发生日期<DateSheetField
            v-model="form.date"
            label="选择往来发生日期"
            :max="localDate()"
            :disabled="busy || uploadingAttachments"
          /></label><label class="form-field">到期日期（选填）<DateSheetField
            v-model="form.dueDate"
            label="选择到期日期"
            :min="form.date"
            clearable
            :disabled="busy || uploadingAttachments"
          /></label><label class="form-field">记录方式<SheetSelect
            v-model="form.cashMovement"
            label="往来记录方式"
            :disabled="busy || uploadingAttachments"
            :options="[
              {
                value: true,
                label:
                  form.direction === 'receivable' ? '本次借出' : '本次借入',
                description: '产生资金流，不计入普通收支',
              },
              {
                value: false,
                label: '补录已有往来',
                description: '只建立往来余额，不记录资金流',
              },
            ]"
          /></label><label class="form-field">备注<input
            v-model="form.note"
            maxlength="200"
          ></label>
          <label
            v-if="form.cashMovement"
            class="form-field"
          >资金账户<SheetSelect
            v-model="form.accountId"
            label="选择资金账户"
            :options="[
              { value: '', label: '不指定账户' },
              ...accounts
                .filter((a) => !a.archived)
                .map((a) => ({ value: a.id, label: a.name })),
            ]"
          /></label>
          <p class="muted">
            本金不会计入普通收入、支出，收还款需关联这笔往来。
          </p>
        </template><template v-else-if="modal === 'settle'">
          <p>
            <b>{{ target?.counterparty }}</b> ·
            {{ target?.direction === "receivable" ? "收款" : "还款" }}总额 ¥
            {{ formatMoney(totalAmount) }}
          </p>
          <div
            v-for="row in candidates"
            :key="row.id"
            class="allocation-row"
          >
            <label><input
              type="checkbox"
              :checked="row.id in allocations"
              @change="changeAllocation(row, $event)"
            >{{ row.date }} · {{ row.note || "往来"
            }}<small>剩余 {{ formatMoney(row.remaining) }}</small></label><label
              v-if="row.id in allocations"
              class="form-field"
            >分配金额<input
              v-model="allocations[row.id]"
              inputmode="decimal"
              required
              :aria-label="`${row.date} 分配金额`"
            ></label>
          </div>
          <label class="form-field">收还款日期<DateSheetField
            v-model="settleDate"
            label="选择收还款日期"
            :max="localDate()"
            :disabled="busy || uploadingAttachments"
          /></label><label class="form-field">备注<input
            v-model="settleNote"
            maxlength="200"
          ></label>
          <label class="form-field">资金账户<SheetSelect
            v-model="settleAccount"
            label="选择资金账户"
            :options="[
              { value: '', label: '不指定账户' },
              ...accounts
                .filter((a) => !a.archived)
                .map((a) => ({ value: a.id, label: a.name })),
            ]"
          /></label>
          <p class="muted">
            可以部分结算；只能分配到同一对象、同一方向的往来。
          </p>
        </template>
        <p v-else>
          撤销 {{ reverseTarget?.date }} {{ reverseTarget?.counterparty }} 的 ¥
          {{ formatMoney(reverseTarget?.amount || "0") }}
          收还款。关联余额将恢复，原日期的统计同步修正。此操作用于纠正误记，实际退款需另行记录。
        </p>
      </fieldset>
      <AttachmentPicker
        v-if="modal === 'create' || modal === 'settle'"
        v-model="attachmentResourceIds"
        :ledger-id="ledgerId"
        :disabled="busy"
        @busy="uploadingAttachments = $event"
      />
      <p
        v-if="formError"
        class="form-error"
        role="alert"
      >
        {{ formError }}
      </p>
    </form>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        :disabled="busy || uploadingAttachments"
        @click="modal = null"
      > 取消</button><button
        class="button button-primary"
        :disabled="busy || uploadingAttachments"
        type="submit"
        form="ledger-debt-form"
      >
        {{ busy ? "正在保存…" : modal === "reverse" ? "确认撤销" : "确认保存" }}
      </button>
    </template>
  </BottomSheet>
</template>
