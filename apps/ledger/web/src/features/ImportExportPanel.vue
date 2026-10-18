<script setup lang="ts">
import type {
  BillCategory,
  LedgerBatchResult,
  LedgerExport,
  LedgerImportDraft,
  LedgerImportRow,
} from '@t-box/ledger-contracts'
import type { FormValues, LedgerFormField } from './form'
import { parseCsv } from '@t-box/ledger-contracts'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onMounted, ref } from 'vue'
import { localDate } from '../bills/format'
import { ErrorCode } from '../error-codes.js'
import { featureApi, useFeatureAction } from './api'
import LedgerFormSheet from './LedgerFormSheet.vue'

const props = defineProps<{ ledgerId: string, canWrite: boolean }>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const csv = ref('')
const headers = ref<string[]>([])
const mapping = ref<FormValues>({})
const mappingOpen = ref(false)
const draft = ref<LedgerImportDraft>()
const rows = ref<
  (LedgerImportRow & {
    selected: boolean
    editable: {
      type: string
      amount: string
      category: string
      date: string
      note: string
      accountId: string | null
    }
  })[]
>([])
const allowDuplicates = ref(false)
const categories = ref<BillCategory[]>([])
const previewOpen = ref(false)
const exportOpen = ref(false)
const exportForm = ref<FormValues>({
  start: localDate().slice(0, 4) + '-01-01',
  end: localDate(),
  kind: 'bills',
  type: '',
  categoryId: '',
  memberId: '',
})
const mappingFields = computed<LedgerFormField[]>(() =>
  Object.entries({
    type: '收支类型',
    amount: '金额',
    category: '分类',
    date: '日期',
    note: '备注',
    accountId: '资金账户 ID',
  }).map(([key, label]) => ({
    key,
    label,
    kind: 'select',
    options: [
      { value: '', label: '不导入此列' },
      ...headers.value.map((h) => ({ value: h, label: h })),
    ],
  })),
)
const exportFields = computed<LedgerFormField[]>(() => [
  { key: 'start', label: '开始日期', kind: 'date' },
  { key: 'end', label: '结束日期', kind: 'date' },
  {
    key: 'kind',
    label: '导出内容',
    kind: 'select',
    options: [
      { value: 'bills', label: '收入支出' },
      { value: 'debts', label: '应收应付' },
      { value: 'settlements', label: '收还款（含关联分配）' },
      { value: 'refunds', label: '退款' },
      { value: 'reimbursements', label: '报销到账' },
      { value: 'events', label: '完整财务事件（含修正）' },
      { value: 'accountEntries', label: '账户流水' },
    ],
  },
  {
    key: 'type',
    label: '收支类型（仅收支导出）',
    kind: 'select',
    options: [
      { value: '', label: '全部' },
      { value: 'income', label: '收入' },
      { value: 'expense', label: '支出' },
    ],
  },
  {
    key: 'categoryId',
    label: '分类（仅收支导出）',
    kind: 'select',
    options: [
      { value: '', label: '全部分类' },
      ...categories.value.map((c) => ({ value: c.id, label: c.label })),
    ],
  },
])
async function file(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) {
    return
  }
  try {
    csv.value = await f.text()
    headers.value = parseCsv(csv.value.replace(/^\ufeff/, ''))[0] ?? []
    if (!headers.value.length) {
      throw ErrorCode.INTERNAL_CSV_HEADER_REQUIRED()
    }
    mapping.value = Object.fromEntries(
      Object.entries({
        type: '类型',
        amount: '金额',
        category: '分类',
        date: '日期',
        note: '备注',
        accountId: '账户ID',
      }).map(([k, v]) => [k, headers.value.includes(v) ? v : '']),
    )
    mappingOpen.value = true
    action.error.value = ''
  } catch (e) {
    action.error.value = (e as Error).message
  }
  input.value = ''
}
async function preview() {
  const body = { csv: csv.value, mapping: mapping.value }
  const r = await action.run('import-preview', body, (k) =>
    api.write<LedgerImportDraft>('/imports', body, 'POST', k))
  if (r) {
    draft.value = r
    rows.value = r.rows.map((row: LedgerImportRow) => ({
      ...row,
      selected: !row.error && !row.duplicate,
      editable: row.input
        ? { ...row.input, accountId: row.input.accountId ?? null }
        : {
            type:
              row.raw?.type === '收入'
                ? 'income'
                : row.raw?.type === '支出'
                  ? 'expense'
                  : (row.raw?.type ?? 'expense'),
            amount: row.raw?.amount ?? '',
            category:
              categories.value.find(
                (c) =>
                  (c.id === row.raw?.category ||
                    c.label === row.raw?.category) &&
                    c.type ===
                    (row.raw?.type === '收入'
                      ? 'income'
                      : row.raw?.type === '支出'
                        ? 'expense'
                        : row.raw?.type),
              )?.id ?? '',
            date: row.raw?.date ?? localDate(),
            note: row.raw?.note ?? '',
            accountId: row.raw?.accountId || null,
          },
    }))
    mappingOpen.value = false
    previewOpen.value = true
    allowDuplicates.value = false
  }
}
async function commit() {
  if (!draft.value) {
    return
  }
  const chosen = rows.value.filter((r) => r.selected)
  if (!chosen.length) {
    action.error.value = '请至少选择一行'
    return
  }
  const body = {
    rows: chosen.map((r) => ({ index: r.index, input: r.editable })),
    allowDuplicates: allowDuplicates.value,
  }
  const path = `/imports/${draft.value.id}/commit`
  const r = await action.run(path, body, (k) =>
    api.write<LedgerBatchResult>(path, body, 'POST', k))
  if (r) {
    previewOpen.value = false
    action.success.value = `已导入 ${r.items.length} 笔记录`
  }
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportCsv() {
  try {
    const params = new URLSearchParams(
      Object.entries(exportForm.value)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => [k, String(v)]),
    )
    const result = await api.get<LedgerExport>('/export?' + params)
    download(result.filename, result.csv)
    exportOpen.value = false
  } catch (e) {
    action.error.value = (e as Error).message
  }
}
onMounted(async () => {
  try {
    categories.value = await api.get<BillCategory[]>('/categories')
  } catch (e) {
    action.error.value = (e as Error).message
  }
})
</script>

<template>
  <div>
    <div class="feature-toolbar">
      <h2>导入与导出</h2>
      <button
        class="button button-primary"
        @click="
          exportOpen = true;
          action.error.value = '';
        "
      >
        导出 CSV
      </button>
    </div>
    <div class="feature-card">
      <h3 class="feature-section-title">导入账单</h3>
      <p class="feature-hint">
        支持 UTF-8 CSV，每次最多 100
        条。上传后先映射字段，再核对金额、分类和重复记录，确认后才入账。
      </p>
      <div class="feature-inline">
        <label
          v-if="canWrite"
          class="button button-primary"
        >选择 CSV<input
          type="file"
          class="sr-only"
          accept=".csv,text/csv"
          @change="file"
        ></label><button
          class="button button-secondary"
          @click="
            download(
              '账单导入模板.csv',
              '\ufeff类型,金额,分类,日期,备注,账户ID\r\n支出,20.00,餐饮,'
                + localDate()
                + ',早餐,',
            )
          "
        >
          下载模板
        </button>
      </div>
      <p class="feature-hint">
        分类使用当前账本的分类名称或 ID；账户 ID 可留空。AI
        从图片或文件提取的记录也必须先进入导入草稿。
      </p>
    </div>
    <p v-if="action.success.value" class="feature-alert">
      {{ action.success.value }}
    </p>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <LedgerFormSheet
      v-model="mapping"
      :open="mappingOpen"
      title="映射 CSV 字段"
      :fields="mappingFields"
      :busy="action.busy.value"
      :error="action.error.value"
      submit-label="预览记录"
      @close="mappingOpen = false"
      @submit="preview"
    /><LedgerFormSheet
      v-model="exportForm"
      :open="exportOpen"
      title="导出账本"
      :fields="exportFields"
      :error="action.error.value"
      submit-label="导出 CSV"
      @close="exportOpen = false"
      @submit="exportCsv"
    /><BottomSheet
      :open="previewOpen"
      title="核对导入记录"
      :busy="action.busy.value"
      full-height
      compact
      @close="previewOpen = false"
    >
      <p class="feature-hint">
        默认不勾选错误和重复行。可以修正后手动勾选；提交时后端会再次校验。草稿有效期为
        24 小时。
      </p>
      <label class="feature-check"><input
        v-model="allowDuplicates"
        type="checkbox"
      >明确允许导入重复记录</label>
      <div
        v-for="row in rows"
        :key="row.index"
        class="feature-import-row"
      >
        <input
          v-model="row.selected"
          type="checkbox"
          :aria-label="`选择第 ${row.index} 行`"
        >
        <div>
          <strong>第 {{ row.index }} 行{{
            row.duplicate ? " · 检测到重复" : ""
          }}</strong><small
            v-if="row.error"
            class="feature-danger"
          >原始错误：{{ row.error }}</small>
          <div class="feature-import-fields">
            <SheetSelect
              v-model="row.editable.type"
              label="选择收支类型"
              :options="[
                { value: 'expense', label: '支出' },
                { value: 'income', label: '收入' },
              ]"
            /><input
              v-model="row.editable.amount"
              inputmode="decimal"
              aria-label="导入金额"
            ><SheetSelect
              v-model="row.editable.category"
              label="选择分类"
              :options="
                categories
                  .filter(
                    (c) => c.type === row.editable.type && c.active !== false,
                  )
                  .map((c) => ({ value: c.id, label: c.label }))
              "
            /><DateSheetField
              v-model="row.editable.date"
              label="选择日期"
            /><input
              v-model="row.editable.note"
              maxlength="200"
              aria-label="导入备注"
            >
          </div>
        </div>
      </div>
      <p v-if="action.error.value" class="form-error">
        {{ action.error.value }}
      </p>
      <template #footer>
        <button
          class="button button-secondary"
          :disabled="action.busy.value"
          @click="previewOpen = false"
        > 取消</button><button
          class="button button-primary"
          :disabled="action.busy.value"
          @click="commit"
        >
          确认导入 {{ rows.filter((r) => r.selected).length }} 笔
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
