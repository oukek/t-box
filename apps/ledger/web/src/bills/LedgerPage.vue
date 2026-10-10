<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { featureApi, useFeatureAction } from "../features/api";
import type { LedgerAccount } from "@t-box/ledger-contracts";
import AttachmentPicker from "../features/AttachmentPicker.vue";
import BillDetailSheet from "../features/BillDetailSheet.vue";
import LedgerFormSheet from "../features/LedgerFormSheet.vue";
import type { FormValues, LedgerFormField } from "../features/form";
import { SheetSelect } from "@t-box/ui-kit";
import { identity } from "@t-box/app-shell-sdk";
import DateSheetField from "@t-box/ui-kit/DateSheetField.vue";
import { AppIcon, BottomSheet } from "@t-box/ui-kit";
import { useLedger } from "./useLedger";
import CategoryDialog from "../categories/CategoryDialog.vue";
import CategoryIcon from "../categories/CategoryIcon.vue";
import CategoryPicker from "./CategoryPicker.vue";
const props = defineProps<{
  ledgerId: string;
  canWrite: boolean;
  canManage: boolean;
  month?: string;
  billId?: string;
  openRevision?: number;
}>();
const {
  month,
  extraFilters,
  allCategories,
  openCopy,
  filter,
  search,
  page,
  total,
  bills,
  summary,
  loading,
  error,
  toast,
  editorOpen,
  confirmation,
  amountInput,
  createButton,
  editingId,
  deletingBill,
  saving,
  deleting,
  formError,
  deleteError,
  draft,
  monthTitle,
  yearTitle,
  pageCount,
  hasFilters,
  categories,
  categoryInfo,
  categoryFormVisible,
  categorySaving,
  categorySaved,
  groups,
  expensesByCategory,
  categoryLabel,
  loadBills,
  moveMonth,
  resetFilters,
  openEditor,
  closeEditor,
  saveBill,
  openDelete,
  closeDelete,
  removeBill,
  restoreFocus,
  formatDate,
  formatMoney,
} = useLedger(props);
const api = featureApi(props.ledgerId),
  featureAction = useFeatureAction(),
  uploadingAttachments = ref(false),
  detailId = ref<string | null>(null),
  accounts = ref<LedgerAccount[]>([]),
  members = ref<any[]>([]),
  filterOpen = ref(false),
  filterForm = ref<FormValues>({}),
  multi = ref(false),
  selectedIds = ref<string[]>([]),
  recategorizeOpen = ref(false),
  recategorizeForm = ref<FormValues>({ categoryId: "" });
const filterFields = computed<LedgerFormField[]>(() => [
  {
    key: "categoryId",
    label: "分类",
    kind: "select",
    options: [
      { value: "", label: "全部分类" },
      ...allCategories.value.map((c) => ({ value: c.id, label: c.label })),
    ],
  },
  {
    key: "memberId",
    label: "记录人",
    kind: "select",
    options: [
      { value: "", label: "全部成员" },
      ...members.value.map((m) => ({ value: m.userId, label: m.nickname })),
    ],
  },
  { key: "minAmount", label: "最低金额（选填）", kind: "money" },
  { key: "maxAmount", label: "最高金额（选填）", kind: "money" },
  { key: "start", label: "开始日期（选填）", kind: "date", clearable: true },
  { key: "end", label: "结束日期（选填）", kind: "date", clearable: true },
]);
const selectedTypes = computed(
  () =>
    new Set(
      bills.value
        .filter((b) => selectedIds.value.includes(b.id))
        .map((b) => b.type),
    ),
);
const recategorizeFields = computed<LedgerFormField[]>(() => [
  {
    key: "categoryId",
    label: "新的分类",
    kind: "select",
    options: allCategories.value
      .filter(
        (c) =>
          c.active !== false &&
          selectedTypes.value.size === 1 &&
          selectedTypes.value.has(c.type),
      )
      .map((c) => ({ value: c.id, label: c.label })),
  },
]);
function filters() {
  filterForm.value = { ...extraFilters };
  filterOpen.value = true;
  featureAction.error.value = "";
}
function applyFilters() {
  const v = filterForm.value;
  if (Boolean(v.start) !== Boolean(v.end)) {
    featureAction.error.value = "请同时选择开始日期和结束日期";
    return;
  }
  Object.assign(extraFilters, v);
  page.value = 1;
  filterOpen.value = false;
}
async function changeCategories() {
  const body = {
    billIds: selectedIds.value,
    categoryId: recategorizeForm.value.categoryId,
  };
  const r = await featureAction.run("recategorize", body, (k) =>
    api.write("/bills/recategorize", body, "POST", k),
  );
  if (r) {
    recategorizeOpen.value = false;
    multi.value = false;
    selectedIds.value = [];
    await loadBills();
  }
}
async function copyBill(bill: import("@t-box/ledger-contracts").Bill) {
  detailId.value = null;
  await openCopy(bill);
}
watch(bills, () => {
  selectedIds.value = [];
});
onMounted(async () => {
  try {
    [accounts.value, members.value] = await Promise.all([
      api.get("/accounts"),
      api.get("/members"),
    ]);
  } catch {
    /* The main list displays access errors; optional pickers remain empty. */
  }
});
</script>

<template>
  <section class="ledger-feature">
    <div class="main-content ledger-content">
      <section class="month-overview" aria-labelledby="month-title">
        <div class="month-heading">
          <h2 id="month-title" class="sr-only">
            {{ yearTitle }} {{ monthTitle }}收支
          </h2>
          <div class="month-controls">
            <button
              class="icon-button"
              aria-label="上个月"
              :disabled="month === '1900-01'"
              @click="moveMonth(-1)"
            >
              <AppIcon name="left" :size="18" />
            </button>
            <DateSheetField
              v-model="month"
              mode="month"
              label="选择账单月份"
              compact
            />
            <button
              class="icon-button"
              aria-label="下个月"
              :disabled="month === '9999-12'"
              @click="moveMonth(1)"
            >
              <AppIcon name="right" :size="18" />
            </button>
          </div>
          <button
            :ref="
              (el) => {
                createButton = el as HTMLButtonElement | undefined;
              }
            "
            v-if="canWrite"
            class="button button-primary add-button"
            @click="openEditor()"
          >
            <AppIcon name="plus" /><span>记一笔</span>
          </button>
        </div>
        <div class="summary-grid" :aria-busy="loading">
          <div class="summary-cell expense-summary">
            <div class="summary-label">
              <span class="summary-indicator expense"
                ><AppIcon name="arrowUp" :size="15" /></span
              >本月净支出
            </div>
            <p class="summary-value">
              <span class="currency">¥</span
              >{{ loading || error ? "—" : formatMoney(summary.expense) }}
            </p>
          </div>
          <div class="summary-cell">
            <div class="summary-label">
              <span class="summary-indicator income"
                ><AppIcon name="arrowDown" :size="15" /></span
              >本月收入
            </div>
            <p class="summary-value">
              <span class="currency">¥</span
              >{{ loading || error ? "—" : formatMoney(summary.income) }}
            </p>
          </div>
          <div class="summary-cell balance-summary">
            <div class="summary-label">本月结余</div>
            <p class="summary-value">
              <span class="currency">¥</span
              >{{ loading || error ? "—" : formatMoney(summary.balance) }}
            </p>
            <span class="summary-detail"
              >{{ loading || error ? "—" : summary.count }} 笔记录</span
            >
          </div>
        </div>
      </section>

      <div class="ledger-layout">
        <section class="ledger-panel" aria-labelledby="ledger-title">
          <div class="section-heading">
            <h2 id="ledger-title">
              账单明细<span v-if="!loading && !error" class="count-tag">{{
                total
              }}</span>
            </h2>
            <span class="section-note">人民币 · CNY</span>
          </div>
          <div class="feature-actions">
            <button @click="filters">筛选</button
            ><button
              v-if="canWrite"
              @click="
                multi = !multi;
                selectedIds = [];
              "
            >
              {{ multi ? "退出多选" : "多选" }}</button
            ><button
              v-if="multi && selectedIds.length"
              @click="
                recategorizeOpen = true;
                featureAction.error.value = '';
              "
            >
              调整分类（{{ selectedIds.length }}）
            </button>
          </div>
          <p v-if="extraFilters.start" class="feature-hint">
            明细按所选日期范围筛选；顶部汇总仍为所选月份。
          </p>
          <div class="ledger-toolbar">
            <div
              class="segmented-control"
              role="group"
              aria-label="收支类型筛选"
            >
              <button
                :aria-pressed="filter === 'all'"
                :class="{ active: filter === 'all' }"
                @click="filter = 'all'"
              >
                全部
              </button>
              <button
                :aria-pressed="filter === 'expense'"
                :class="{ active: filter === 'expense' }"
                @click="filter = 'expense'"
              >
                支出
              </button>
              <button
                :aria-pressed="filter === 'income'"
                :class="{ active: filter === 'income' }"
                @click="filter = 'income'"
              >
                收入
              </button>
            </div>
            <label class="search-field"
              ><AppIcon name="search" :size="18" /><input
                v-model="search"
                type="search"
                maxlength="100"
                placeholder="搜索备注"
                aria-label="搜索账单备注"
            /></label>
          </div>

          <div v-if="loading" class="state-panel loading-state" role="status">
            <span class="spinner"></span>
            <p>正在读取账单…</p>
          </div>
          <div v-else-if="error" class="state-panel error-state" role="alert">
            <span class="state-icon"
              ><AppIcon name="warning" :size="28"
            /></span>
            <h3>账单暂时无法加载</h3>
            <p>{{ error }}</p>
            <button class="button button-secondary" @click="loadBills">
              <AppIcon name="refresh" :size="16" />重新加载
            </button>
          </div>
          <div v-else-if="bills.length === 0" class="state-panel empty-state">
            <span class="empty-ledger"
              ><AppIcon name="ledger" :size="26"
            /></span>
            <h3>
              {{ hasFilters ? "没有符合条件的记录" : "暂无账单" }}
            </h3>
            <p>
              {{
                hasFilters
                  ? "试试其他关键词，或查看全部收支。"
                  : "记录一笔收入或支出。"
              }}
            </p>
            <button
              v-if="hasFilters"
              class="button button-secondary"
              @click="resetFilters"
            >
              清除筛选</button
            ><button
              v-else-if="canWrite"
              class="button button-secondary"
              @click="openEditor()"
            >
              <AppIcon name="plus" :size="17" />记下第一笔
            </button>
          </div>
          <div v-else class="bill-groups">
            <section
              v-for="group in groups"
              :key="group.date"
              class="bill-group"
              :aria-label="formatDate(group.date)"
            >
              <div class="date-divider">
                <time :datetime="group.date">{{ formatDate(group.date) }}</time
                ><span>{{ group.bills.length }} 笔</span>
              </div>
              <article
                v-for="bill in group.bills"
                :key="bill.id"
                class="bill-row"
                :class="{ 'target-bill': bill.id === props.billId }"
              >
                <input
                  v-if="multi"
                  v-model="selectedIds"
                  type="checkbox"
                  :value="bill.id"
                  :aria-label="`选择 ${bill.date} ${bill.amount} 元账单`"
                />
                <span class="category-icon" :class="bill.type"
                  ><CategoryIcon
                    :ledger-id="ledgerId"
                    :icon="categoryInfo(bill.category)?.icon"
                    :icon-id="categoryInfo(bill.category)?.iconId"
                    :size="21"
                /></span>
                <button
                  type="button"
                  class="bill-description bill-description-trigger"
                  :aria-label="`查看 ${bill.date} ${categoryLabel(bill.category)} ${bill.amount} 元账单详情`"
                  @click="detailId = bill.id"
                >
                  <h3>{{ categoryLabel(bill.category) }}</h3>
                  <p :class="{ 'muted-note': !bill.note }">
                    {{
                      bill.note ||
                      (bill.type === "income" ? "收入记录" : "日常支出")
                    }}
                  </p>
                </button>
                <div class="bill-amount" :class="bill.type">
                  <span class="sr-only">{{
                    bill.type === "income" ? "收入" : "支出"
                  }}</span
                  >{{ bill.type === "income" ? "+" : "−"
                  }}{{ formatMoney(bill.amount) }}
                </div>
                <div
                  v-if="
                    canWrite &&
                    (canManage || bill.createdBy === identity.user?.id)
                  "
                  class="bill-actions"
                >
                  <button
                    class="icon-button"
                    :aria-label="`编辑 ${bill.date} ${categoryLabel(
                      bill.category,
                    )} ${bill.amount} 元`"
                    title="编辑账单"
                    @click="openEditor(bill)"
                  >
                    <AppIcon name="edit" :size="17" /></button
                  ><button
                    class="icon-button delete-action"
                    :aria-label="`删除 ${bill.date} ${categoryLabel(
                      bill.category,
                    )} ${bill.amount} 元`"
                    title="删除账单"
                    @click="openDelete(bill)"
                  >
                    <AppIcon name="trash" :size="17" />
                  </button>
                </div>
              </article>
            </section>
            <footer class="pagination">
              <span
                >共 {{ total }} 笔<span class="pagination-page">
                  · {{ page }} / {{ pageCount }} 页</span
                ></span
              >
              <div>
                <button
                  class="icon-button"
                  aria-label="上一页"
                  :disabled="page <= 1"
                  @click="page--"
                >
                  <AppIcon name="left" :size="18" /></button
                ><button
                  class="icon-button"
                  aria-label="下一页"
                  :disabled="page >= pageCount"
                  @click="page++"
                >
                  <AppIcon name="right" :size="18" />
                </button>
              </div>
            </footer>
          </div>
        </section>

        <aside class="distribution-panel" aria-labelledby="distribution-title">
          <div class="section-heading">
            <h2 id="distribution-title">支出去向</h2>
            <span class="small-label">本月</span>
          </div>
          <div v-if="loading || error" class="distribution-empty">
            {{ loading ? "正在汇总…" : "暂无可用数据" }}
          </div>
          <template v-else-if="expensesByCategory.length">
            <p
              v-if="summary.categories.some((c) => Number(c.amount) < 0)"
              class="feature-hint"
            >
              负净额分类已计入净支出；分布仅按正净额计算。
            </p>
            <div class="distribution-total">
              <span>支出总额</span
              ><strong>¥ {{ formatMoney(summary.expense) }}</strong>
            </div>
            <ol class="distribution-list">
              <li
                v-for="(category, index) in expensesByCategory"
                :key="category.category"
              >
                <div class="distribution-label">
                  <span
                    ><span class="category-index">{{
                      String(index + 1).padStart(2, "0")
                    }}</span
                    >{{ categoryLabel(category.category) }}</span
                  ><strong
                    >{{ Math.round(category.percent) }}<small>%</small></strong
                  >
                </div>
                <div class="category-bar">
                  <span
                    :style="{
                      width: `${category.percent}%`,
                      opacity: Math.max(0.35, 1 - index * 0.11),
                    }"
                  ></span>
                </div>
                <div class="category-total">
                  ¥ {{ formatMoney(category.amount) }}
                </div>
              </li>
            </ol>
          </template>
          <div v-else class="distribution-empty">
            <AppIcon name="other" :size="26" />
            <p>
              {{
                Number(summary.expense) < 0
                  ? "本期仅有退款或报销抵减"
                  : "还没有支出记录"
              }}
            </p>
            <span>记账后，在这里了解花费分布。</span>
          </div>
        </aside>
      </div>
    </div>
  </section>

  <BottomSheet
    :open="editorOpen"
    :title="editingId ? '编辑账单' : '记一笔'"
    :busy="saving || categorySaving || uploadingAttachments"
    full-height
    compact
    @close="closeEditor"
    @opened="amountInput?.focus()"
  >
    <form
      id="ledger-bill-form"
      @submit.prevent="!uploadingAttachments && saveBill()"
    >
      <fieldset
        :disabled="saving || categorySaving || uploadingAttachments"
        class="form-fields"
      >
        <legend class="sr-only">账单详情</legend>
        <div class="form-type-control">
          <label :class="{ selected: draft.type === 'expense' }"
            ><input
              v-model="draft.type"
              type="radio"
              value="expense"
              name="billType"
            /><AppIcon name="arrowUp" :size="17" />支出</label
          ><label :class="{ selected: draft.type === 'income' }"
            ><input
              v-model="draft.type"
              type="radio"
              value="income"
              name="billType"
            /><AppIcon name="arrowDown" :size="17" />收入</label
          >
        </div>
        <label class="amount-field"
          ><span class="field-label"
            >金额 <span class="required-mark">*</span></span
          ><span class="amount-input-wrap"
            ><span>¥</span
            ><input
              :ref="
                (el) => {
                  amountInput = el as HTMLInputElement | undefined;
                }
              "
              v-model="draft.amount"
              name="amount"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
              maxlength="12"
              required
              aria-label="金额"
              :aria-describedby="formError ? 'form-error' : undefined" /></span
        ></label>
        <fieldset class="category-field">
          <legend class="field-label">
            分类 <span class="required-mark">*</span>
          </legend>
          <CategoryPicker
            v-if="editorOpen"
            :key="draft.type"
            v-model="draft.category"
            :ledger-id="ledgerId"
            :categories="categories"
            :type="draft.type"
            :disabled="saving || categorySaving || uploadingAttachments"
          />
          <button
            type="button"
            class="category-add-toggle"
            :aria-expanded="categoryFormVisible"
            aria-haspopup="dialog"
            @click="categoryFormVisible = true"
          >
            ＋ 添加{{ draft.type === "income" ? "收入" : "支出" }}分类
          </button>
        </fieldset>

        <label class="form-field"
          ><span class="field-label"
            >日期 <span class="required-mark">*</span></span
          ><DateSheetField
            v-model="draft.date"
            label="选择账单日期"
            :disabled="saving"
        /></label>
        <div class="form-field">
          <span class="field-label">资金账户</span
          ><SheetSelect
            :model-value="draft.accountId ?? ''"
            :options="[
              { value: '', label: '不指定账户' },
              ...accounts
                .filter((a) => !a.archived)
                .map((a) => ({ value: a.id, label: a.name })),
            ]"
            label="选择资金账户"
            @update:model-value="draft.accountId = $event || null"
          />
        </div>
        <label class="form-field"
          ><span class="field-label"
            >备注 <span class="optional-label">选填</span></span
          ><input
            v-model="draft.note"
            type="text"
            name="note"
            maxlength="200"
            placeholder="这笔收支，想记点什么？"
        /></label>
        <AttachmentPicker
          v-if="editorOpen"
          :model-value="draft.attachmentResourceIds ?? []"
          :ledger-id="ledgerId"
          :disabled="saving"
          @update:model-value="draft.attachmentResourceIds = $event"
          @busy="uploadingAttachments = $event"
        />
      </fieldset>
      <p v-if="formError" id="form-error" class="form-error" role="alert">
        {{ formError }}
      </p>
    </form>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        :disabled="saving || categorySaving || uploadingAttachments"
        @click="closeEditor"
      >
        取消</button
      ><button
        class="button button-primary"
        :disabled="saving || categorySaving || uploadingAttachments"
        type="submit"
        form="ledger-bill-form"
      >
        <span v-if="saving" class="spinner small"></span
        ><AppIcon v-else name="check" :size="18" />{{
          saving ? "正在保存…" : "保存账单"
        }}
      </button>
    </template>
  </BottomSheet>

  <CategoryDialog
    :open="categoryFormVisible && editorOpen"
    :ledger-id="ledgerId"
    :type="draft.type"
    @close="categoryFormVisible = false"
    @saved="categorySaved"
    @busy="categorySaving = $event"
  />

  <BillDetailSheet
    :ledger-id="ledgerId"
    :bill-id="detailId"
    :can-write="canWrite"
    :category-label="categoryLabel"
    @close="detailId = null"
    @copy="copyBill"
    @changed="loadBills"
  />
  <LedgerFormSheet
    v-model="filterForm"
    :open="filterOpen"
    title="筛选账单明细"
    :fields="filterFields"
    :error="featureAction.error.value"
    submit-label="应用筛选"
    @close="filterOpen = false"
    @submit="applyFilters"
  />
  <LedgerFormSheet
    v-model="recategorizeForm"
    :open="recategorizeOpen"
    title="批量调整分类"
    :fields="recategorizeFields"
    :description="`将调整 ${selectedIds.length} 笔记录，仅可选择同一种收支类型；有退款或报销的记录不能直接调整。`"
    :busy="featureAction.busy.value"
    :error="featureAction.error.value"
    @close="recategorizeOpen = false"
    @submit="changeCategories"
  />
  <dialog
    ref="confirmation"
    class="dialog confirm-dialog"
    aria-labelledby="delete-title"
    aria-describedby="delete-description"
    @cancel.prevent="closeDelete"
    @close="restoreFocus"
    @click="
      (event) => {
        if (event.target === confirmation) closeDelete();
      }
    "
  >
    <div class="dialog-content">
      <span class="delete-symbol"><AppIcon name="trash" :size="24" /></span>
      <h2 id="delete-title">删除这笔账单？</h2>
      <p v-if="deletingBill" id="delete-description" class="delete-description">
        {{ deletingBill.date }} 的{{ categoryLabel(deletingBill.category)
        }}{{ deletingBill.type === "income" ? "收入" : "支出" }} ¥
        {{ formatMoney(deletingBill.amount) }}
        将被删除，删除后移入回收站，可恢复。
      </p>
      <p v-if="deleteError" class="form-error" role="alert">
        {{ deleteError }}
      </p>
      <div class="dialog-footer">
        <button
          class="button button-secondary"
          autofocus
          :disabled="deleting"
          @click="closeDelete"
        >
          保留账单</button
        ><button
          class="button button-danger"
          :disabled="deleting"
          @click="removeBill"
        >
          {{ deleting ? "正在删除…" : "确认删除" }}
        </button>
      </div>
    </div>
  </dialog>

  <div class="toast-region" role="status" aria-live="polite">
    <Transition name="toast"
      ><div v-if="toast" class="toast-message">
        <AppIcon name="check" :size="18" />{{ toast }}
      </div></Transition
    >
  </div>
</template>
