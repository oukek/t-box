<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { BottomSheet } from "@t-box/ui-kit";
import type { BillCategory, LedgerAccount } from "@t-box/ledger-contracts";
import { featureApi, useFeatureAction } from "./api";
import LedgerFormSheet from "./LedgerFormSheet.vue";
import type { FormValues, LedgerFormField } from "./form";
import { localDate } from "../bills/format";
const props = defineProps<{
    ledgerId: string;
    canWrite: boolean;
    template: string;
  }>(),
  api = featureApi(props.ledgerId),
  action = useFeatureAction(),
  categories = ref<BillCategory[]>([]),
  accounts = ref<LedgerAccount[]>([]),
  debts = ref<any[]>([]),
  bills = ref<any[]>([]),
  items = ref<{ kind: string; input: any }[]>([]),
  editor = ref(false),
  editing = ref(-1),
  confirmation = ref(false),
  attachmentResourceIds = ref<string[]>([]),
  form = ref<FormValues>({});
const accountOptions = computed(() => [
  { value: "", label: "不指定账户" },
  ...accounts.value
    .filter((a) => !a.archived)
    .map((a) => ({ value: a.id, label: a.name })),
]);
const kindOptions = computed(() =>
  [
    { value: "bill", label: "普通收支" },
    { value: "debt", label: "登记往来" },
    { value: "settlement", label: "收款 / 还款" },
    { value: "refund", label: "退款" },
    { value: "transfer", label: "账户转账" },
  ].filter((r) =>
    props.template === "daily"
      ? !["debt", "settlement"].includes(r.value)
      : props.template === "debt"
        ? !["bill", "refund"].includes(r.value)
        : true,
  ),
);
const fields = computed<LedgerFormField[]>(() => {
  const list: LedgerFormField[] = [
    {
      key: "kind",
      label: "记录类型",
      kind: "select",
      options: kindOptions.value,
    },
  ];
  if (form.value.kind === "bill")
    list.push(
      {
        key: "type",
        label: "收支方向",
        kind: "select",
        options: [
          { value: "expense", label: "支出" },
          { value: "income", label: "收入" },
        ],
      },
      {
        key: "category",
        label: "分类",
        kind: "select",
        options: categories.value
          .filter((c) => c.type === form.value.type && c.active !== false)
          .map((c) => ({ value: c.id, label: c.label })),
      },
    );
  if (form.value.kind === "debt")
    list.push(
      {
        key: "direction",
        label: "往来方向",
        kind: "select",
        options: [
          { value: "receivable", label: "应收（别人欠账本）" },
          { value: "payable", label: "应付（账本欠别人）" },
        ],
      },
      { key: "counterparty", label: "往来对象", required: true, max: 80 },
      {
        key: "dueDate",
        label: "到期日（选填）",
        kind: "date",
        clearable: true,
      },
      {
        key: "cashMovement",
        label: "本次借出 / 借入产生资金流",
        kind: "checkbox",
      },
    );
  if (form.value.kind === "settlement")
    list.push({
      key: "debtId",
      label: "关联往来",
      kind: "select",
      options: debts.value.map((r) => ({
        value: r.id,
        label: `${r.counterparty} · ${r.direction === "receivable" ? "应收" : "应付"} · 剩余 ${r.remaining}`,
      })),
    });
  if (form.value.kind === "refund")
    list.push({
      key: "billId",
      label: "原支出账单",
      kind: "select",
      options: bills.value
        .filter((r) => r.type === "expense")
        .map((r) => ({
          value: r.id,
          label: `${r.date} · ${r.note || categories.value.find((c) => c.id === r.category)?.label} · ${r.amount} 元`,
        })),
    });
  if (form.value.kind === "transfer")
    list.push(
      {
        key: "fromAccountId",
        label: "转出账户",
        kind: "select",
        options: accountOptions.value.filter((a) => a.value),
      },
      {
        key: "toAccountId",
        label: "转入账户",
        kind: "select",
        options: accountOptions.value.filter((a) => a.value),
      },
    );
  list.push(
    { key: "amount", label: "金额", kind: "money", required: true },
    { key: "date", label: "发生日期", kind: "date" },
    { key: "note", label: "备注" },
  );
  if (form.value.kind !== "transfer")
    list.push({
      key: "accountId",
      label: "资金账户",
      kind: "select",
      options: accountOptions.value,
    });
  return list;
});
watch(
  () => form.value.type,
  () => {
    if (
      !categories.value.some(
        (c) =>
          c.type === form.value.type &&
          c.id === form.value.category &&
          c.active !== false,
      )
    )
      form.value.category =
        categories.value.find(
          (c) => c.type === form.value.type && c.active !== false,
        )?.id ?? "";
  },
);
function open(index = -1) {
  editing.value = index;
  const row = items.value[index],
    input = row?.input ?? {};
  form.value = {
    kind: row?.kind ?? kindOptions.value[0]?.value ?? "bill",
    type: "expense",
    category:
      categories.value.find((c) => c.type === "expense" && c.active !== false)
        ?.id ?? "",
    direction: "receivable",
    counterparty: "",
    dueDate: "",
    cashMovement: true,
    amount: "",
    date: localDate(),
    note: "",
    accountId: "",
    fromAccountId: accountOptions.value[1]?.value ?? "",
    toAccountId: accountOptions.value[2]?.value ?? "",
    debtId: "",
    billId: "",
    ...input,
    ...(row?.kind === "settlement"
      ? {
          debtId: input.allocations[0].debtId,
          amount: input.allocations[0].amount,
        }
      : {}),
  };
  attachmentResourceIds.value = [...(input.attachmentResourceIds ?? [])];
  editor.value = true;
  action.error.value = "";
}
function saveRow() {
  const v = form.value,
    kind = String(v.kind),
    base = {
      amount: String(v.amount),
      date: String(v.date),
      note: String(v.note),
    },
    accountId = v.accountId || null;
  const input =
    kind === "bill"
      ? { ...base, type: v.type, category: v.category, accountId }
      : kind === "debt"
        ? {
            ...base,
            direction: v.direction,
            counterparty: v.counterparty,
            dueDate: v.dueDate || null,
            cashMovement: v.cashMovement,
            accountId: v.cashMovement ? accountId : null,
          }
        : kind === "settlement"
          ? {
              date: v.date,
              note: v.note,
              accountId,
              allocations: [{ debtId: v.debtId, amount: String(v.amount) }],
            }
          : kind === "refund"
            ? { ...base, billId: v.billId, accountId }
            : {
                ...base,
                fromAccountId: v.fromAccountId,
                toAccountId: v.toAccountId,
              };
  Object.assign(input, {
    attachmentResourceIds: [...attachmentResourceIds.value],
  });
  if (editing.value < 0) items.value.push({ kind, input });
  else items.value[editing.value] = { kind, input };
  editor.value = false;
}
function describe(row: { kind: string; input: any }) {
  const v = row.input;
  return row.kind === "bill"
    ? `${v.type === "income" ? "收入" : "支出"} · ${categories.value.find((c) => c.id === v.category)?.label ?? "请选择分类"}`
    : row.kind === "debt"
      ? `${v.direction === "receivable" ? "应收" : "应付"} · ${v.counterparty}`
      : row.kind === "settlement"
        ? "登记收还款"
        : row.kind === "refund"
          ? "登记退款"
          : "账户转账";
}
async function submit() {
  const input = { items: items.value };
  const r = await action.run("batch", input, (k) =>
    api.write("/batch", input, "POST", k),
  );
  if (r) {
    confirmation.value = false;
    items.value = [];
    action.success.value = `已成功记录 ${r.items.length} 笔`;
  }
}
onMounted(async () => {
  try {
    [categories.value, accounts.value, debts.value, bills.value] =
      await Promise.all([
        api.get("/categories"),
        api.get("/accounts"),
        props.template === "daily"
          ? Promise.resolve([])
          : api.get("/debts?status=open&pageSize=100"),
        props.template === "debt"
          ? Promise.resolve([])
          : api.get("/bills?pageSize=100"),
      ]);
  } catch (e) {
    action.error.value = (e as Error).message;
  }
});
</script>
<template>
  <div>
    <div class="feature-toolbar">
      <h2>批量记录</h2>
      <button
        v-if="canWrite"
        class="button button-primary"
        :disabled="items.length >= 100"
        @click="open()"
      >
        添加一笔
      </button>
    </div>
    <p class="feature-hint">
      支持混合收支、往来、收还款、退款和转账。每批最多 100
      笔；任意一笔失败全部回滚，失败重试不会重复入账。
    </p>
    <div class="feature-card">
      <div v-for="(row, index) in items" :key="index" class="feature-row">
        <div>
          <strong>{{ index + 1 }}. {{ describe(row) }}</strong
          ><small
            >{{ row.input.date }} ·
            {{ row.input.amount ?? row.input.allocations?.[0]?.amount }} 元 ·
            {{ row.input.note }}</small
          >
        </div>
        <div class="feature-actions">
          <button @click="open(index)">修改</button
          ><button @click="items.splice(index, 1)">移除</button>
        </div>
      </div>
      <p v-if="!items.length" class="feature-empty">先添加记录，再一起提交。</p>
    </div>
    <button
      v-if="items.length && canWrite"
      class="button button-primary"
      @click="confirmation = true"
    >
      核对并提交 {{ items.length }} 笔
    </button>
    <p v-if="action.success.value" class="feature-alert">
      {{ action.success.value }}
    </p>
    <p v-if="action.error.value" class="form-error">{{ action.error.value }}</p>
    <LedgerFormSheet
      v-model="form"
      v-model:attachment-resource-ids="attachmentResourceIds"
      :ledger-id="ledgerId"
      attachments
      :open="editor"
      :title="editing < 0 ? '添加批量记录' : '修改批量记录'"
      :fields="fields"
      submit-label="加入本批"
      @close="editor = false"
      @submit="saveRow"
    /><BottomSheet
      :open="confirmation"
      title="确认批量入账"
      :busy="action.busy.value"
      full-height
      compact
      @close="confirmation = false"
      ><div v-for="(row, index) in items" :key="index" class="feature-row">
        <div>
          <strong>{{ index + 1 }}. {{ describe(row) }}</strong
          ><small
            >{{ row.input.date }} ·
            {{ row.input.amount ?? row.input.allocations?.[0]?.amount }} 元 ·
            {{ row.input.note }}</small
          >
        </div>
      </div>
      <p class="feature-hint">提交只登记账本，不会实际付款或转账。</p>
      <p v-if="action.error.value" class="form-error">
        {{ action.error.value }}
      </p>
      <template #footer
        ><button
          class="button button-secondary"
          :disabled="action.busy.value"
          @click="confirmation = false"
        >
          返回核对</button
        ><button
          class="button button-primary"
          :disabled="action.busy.value"
          @click="submit"
        >
          {{ action.busy.value ? "正在提交…" : "确认入账" }}
        </button></template
      ></BottomSheet
    >
  </div>
</template>
