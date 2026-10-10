import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  type BillCategory,
  type Bill,
  type BillInput,
  type BillSummary,
  type CategoryId,
} from "@t-box/ledger-contracts";
import { featureApi } from "../features/api";
import { createLedgerApi } from "./ledgerApi";
import { formatDate, formatMoney, localDate, normalizeAmount } from "./format";

import { bookState } from "../books/bookStore";
import { createRequestId } from "@t-box/app-shell-sdk";
export function useLedger(props: {
  ledgerId: string;
  month?: string;
  billId?: string;
  openRevision?: number;
}) {
  const api = createLedgerApi(props.ledgerId);
  let operationKey = createRequestId(),
    operationBody = "";
  const month = ref(props.month || localDate().slice(0, 7));
  const filter = ref<"all" | "expense" | "income">("all");
  const search = ref("");
  const extraFilters = reactive({
    categoryId: "",
    memberId: "",
    minAmount: "",
    maxAmount: "",
    start: "",
    end: "",
  });
  const query = ref("");
  const page = ref(1);
  const pageSize = 20;
  const revision = ref(0);
  watch(
    () => props.openRevision,
    () => {
      if (props.month) month.value = props.month;
      resetFilters();
      page.value = 1;
      revision.value++;
    },
  );
  const bills = ref<Bill[]>([]);
  const total = ref(0);
  const summary = ref<BillSummary>({
    income: "0.00",
    expense: "0.00",
    balance: "0.00",
    count: 0,
    categories: [],
  });
  const loading = ref(true);
  const error = ref("");
  const toast = ref("");
  const editorOpen = ref(false);
  const confirmation = ref<HTMLDialogElement>();
  const amountInput = ref<HTMLInputElement>();
  const createButton = ref<HTMLButtonElement>();
  const editingId = ref<string | null>(null);
  const deletingBill = ref<Bill | null>(null);
  const saving = ref(false);
  const deleting = ref(false);
  const formError = ref("");
  const deleteError = ref("");
  const draft = reactive<BillInput>({
    type: "expense",
    amount: "",
    category: "",
    date: localDate(),
    note: "",
  });
  let controller: AbortController | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let returnFocus: HTMLElement | null = null;

  const monthTitle = computed(() => `${Number(month.value.slice(5))} 月`);
  const yearTitle = computed(() => month.value.slice(0, 4));
  const isCurrentMonth = computed(
    () => month.value === localDate().slice(0, 7),
  );
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize)),
  );
  const hasFilters = computed(
    () =>
      filter.value !== "all" ||
      Boolean(query.value) ||
      Object.values(extraFilters).some(Boolean),
  );
  const categoryList = ref<BillCategory[]>([]);
  const recentIds = ref<string[]>([]);
  const categories = computed(() =>
    categoryList.value
      .filter(
        (item) =>
          item.type === draft.type &&
          (item.active !== false || item.id === draft.category),
      )
      .sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          (recentIds.value.indexOf(a.id) < 0
            ? 999
            : recentIds.value.indexOf(a.id)) -
            (recentIds.value.indexOf(b.id) < 0
              ? 999
              : recentIds.value.indexOf(b.id)) ||
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      ),
  );
  const categoryFormVisible = ref(false);
  const categorySaving = ref(false);
  function categoryInfo(id: CategoryId) {
    return categoryList.value.find((item) => item.id === id);
  }
  function categorySaved(category: BillCategory) {
    const index = categoryList.value.findIndex(
      (item) => item.id === category.id,
    );
    if (index < 0) categoryList.value.push(category);
    else categoryList.value[index] = category;
    if (draft.type === category.type) draft.category = category.id;
    categoryFormVisible.value = false;
  }
  const groups = computed(() => {
    const result: { date: string; bills: Bill[] }[] = [];
    for (const bill of bills.value) {
      const previous = result[result.length - 1];
      if (previous?.date === bill.date) previous.bills.push(bill);
      else result.push({ date: bill.date, bills: [bill] });
    }
    return result;
  });
  const expensesByCategory = computed(() => {
    const positive = summary.value.categories.filter(
      (item) => Number(item.amount) > 0,
    );
    const total = positive.reduce((sum, item) => sum + Number(item.amount), 0);
    return positive.map((item) => ({
      ...item,
      percent: total > 0 ? (Number(item.amount) / total) * 100 : 0,
    }));
  });

  function categoryLabel(id: CategoryId) {
    return (
      categoryList.value.find((category) => category.id === id)?.label ||
      "未知分类"
    );
  }

  async function loadBills() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = true;
    error.value = "";
    const params = new URLSearchParams({
      month: month.value,
      page: String(page.value),
      pageSize: String(pageSize),
    });
    for (const [key, value] of Object.entries(extraFilters))
      if (value) params.set(key, value);
    if (extraFilters.start && extraFilters.end) params.delete("month");
    if (filter.value !== "all") params.set("type", filter.value);
    if (query.value) params.set("q", query.value);
    try {
      const [listResponse, summaryResponse, categoryResponse, recents] =
        await Promise.all([
          api.list(params, current.signal),
          api.summary(month.value, current.signal),
          api.categories(current.signal),
          featureApi(props.ledgerId).get<{ categoryId: string }[]>(
            "/categories/recent",
          ),
        ]);
      if (current.signal.aborted) return;
      categoryList.value = categoryResponse.data;
      recentIds.value = recents.map((r) => r.categoryId);
      bills.value = listResponse.data;
      total.value = listResponse.meta.total;
      summary.value = summaryResponse.data;
      if (page.value > pageCount.value) page.value = pageCount.value;
    } catch (cause) {
      if (current.signal.aborted) return;
      error.value =
        cause instanceof Error ? cause.message : "账单加载失败，请稍后重试。";
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }

  watch(
    [month, filter, query, () => JSON.stringify(extraFilters)],
    () => {
      page.value = 1;
    },
    { flush: "sync" },
  );
  watch(
    [
      month,
      filter,
      query,
      page,
      revision,
      () => bookState.revision,
      () => JSON.stringify(extraFilters),
    ],
    loadBills,
    { immediate: true },
  );
  watch(search, (value) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query.value = value.trim();
    }, 250);
  });
  watch(
    () => draft.type,
    () => {
      if (!categories.value.some((item) => item.id === draft.category))
        draft.category = categories.value[0]?.id ?? "";
    },
  );

  function moveMonth(offset: number) {
    const [year, currentMonth] = month.value.split("-").map(Number);
    if (!year || !currentMonth) return;
    const date = new Date(year, currentMonth - 1 + offset, 1);
    const next = localDate(date).slice(0, 7);
    if (next >= "1900-01" && next <= "9999-12") month.value = next;
  }

  function selectMonth(event: Event) {
    const input = event.target as HTMLInputElement;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value) && input.value >= "1900-01")
      month.value = input.value;
    else input.value = month.value;
  }

  function resetFilters() {
    clearTimeout(searchTimer);
    search.value = "";
    query.value = "";
    filter.value = "all";
    for (const key of Object.keys(
      extraFilters,
    ) as (keyof typeof extraFilters)[])
      extraFilters[key] = "";
  }

  function announce(message: string) {
    clearTimeout(toastTimer);
    toast.value = message;
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 3500);
  }

  function rememberFocus() {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  function restoreFocus() {
    if (returnFocus?.isConnected) returnFocus.focus();
    else createButton.value?.focus();
  }

  async function openEditor(bill?: Bill) {
    rememberFocus();
    editingId.value = bill?.id || null;
    operationBody = "";
    operationKey = createRequestId();
    formError.value = "";
    categoryFormVisible.value = false;
    draft.attachmentResourceIds = [];
    Object.assign(
      draft,
      bill
        ? {
            type: bill.type,
            amount: bill.amount,
            category: bill.category,
            date: bill.date,
            note: bill.note,
            accountId: bill.accountId ?? null,
          }
        : {
            type: "expense",
            amount: "",
            category: "",
            date: localDate(),
            note: "",
            accountId: null,
          },
    );
    if (!categories.value.some((category) => category.id === draft.category))
      draft.category = categories.value[0]?.id ?? "";
    editorOpen.value = true;
  }

  async function openCopy(bill: Bill) {
    await openEditor(bill);
    editingId.value = null;
    draft.date = localDate();
  }

  function closeEditor() {
    if (!saving.value && !categorySaving.value) editorOpen.value = false;
  }

  async function saveBill() {
    if (saving.value || categorySaving.value) return;
    if (!categories.value.some((category) => category.id === draft.category)) {
      formError.value = "请选择有效分类或先添加分类";
      return;
    }
    const amount = normalizeAmount(draft.amount.trim());
    if (!amount) {
      formError.value =
        "请输入大于 0 的金额，最多两位小数，上限为 999,999,999.99。";
      amountInput.value?.focus();
      return;
    }
    if (!draft.date || draft.date < "1900-01-01" || draft.date > "9999-12-31") {
      formError.value = "请选择有效的记账日期。";
      return;
    }
    saving.value = true;
    formError.value = "";
    const wasEditing = Boolean(editingId.value);
    try {
      const input: BillInput = {
        type: draft.type,
        category: draft.category,
        amount,
        date: draft.date,
        note: draft.note.trim(),
        attachmentResourceIds: draft.attachmentResourceIds ?? [],
        accountId: draft.accountId || null,
      };
      const payload = JSON.stringify({ id: editingId.value, input });
      if (payload !== operationBody) {
        operationBody = payload;
        operationKey = createRequestId();
      }
      if (editingId.value)
        await api.update(editingId.value, input, operationKey);
      else await api.create(input, operationKey);
      month.value = input.date.slice(0, 7);
      resetFilters();
      page.value = 1;
      revision.value++;
      saving.value = false;
      returnFocus = createButton.value || null;
      editorOpen.value = false;
      announce(wasEditing ? "账单已更新" : "已记下一笔账单");
    } catch (cause) {
      formError.value =
        cause instanceof Error ? cause.message : "保存失败，请重试。";
    } finally {
      saving.value = false;
    }
  }

  function openDelete(bill: Bill) {
    rememberFocus();
    deletingBill.value = bill;
    deleteError.value = "";
    confirmation.value?.showModal();
  }

  function closeDelete() {
    if (!deleting.value) confirmation.value?.close();
  }

  async function removeBill() {
    if (!deletingBill.value || deleting.value) return;
    deleting.value = true;
    deleteError.value = "";
    try {
      await api.remove(deletingBill.value.id);
      revision.value++;
      deleting.value = false;
      returnFocus = createButton.value || null;
      confirmation.value?.close();
      announce("账单已删除");
    } catch (cause) {
      deleteError.value =
        cause instanceof Error ? cause.message : "删除失败，请重试。";
    } finally {
      deleting.value = false;
    }
  }

  onBeforeUnmount(() => {
    controller?.abort();
    clearTimeout(searchTimer);
    clearTimeout(toastTimer);
  });

  return {
    month,
    extraFilters,
    allCategories: categoryList,
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
    isCurrentMonth,
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
    selectMonth,
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
  };
}
