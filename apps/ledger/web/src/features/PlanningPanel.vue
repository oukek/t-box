<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import type {
  BillCategory,
  LedgerAccount,
  LedgerRule,
  BillTemplate,
} from "@t-box/ledger-contracts";
import { featureApi, useFeatureAction } from "./api";
import LedgerFormSheet from "./LedgerFormSheet.vue";
import type { FormValues, LedgerFormField } from "./form";
import { localDate } from "../bills/format";
const props = defineProps<{
    ledgerId: string;
    canWrite: boolean;
    kind: "rules" | "templates";
  }>(),
  api = featureApi(props.ledgerId),
  action = useFeatureAction(),
  rows = ref<(LedgerRule | BillTemplate)[]>([]),
  categories = ref<BillCategory[]>([]),
  accounts = ref<LedgerAccount[]>([]),
  editor = ref<"create" | "apply" | "delete" | "toggle" | null>(null),
  target = ref<any>(),
  form = ref<FormValues>({});
const fields = computed<LedgerFormField[]>(() =>
  editor.value === "delete" || editor.value === "toggle"
    ? []
    : [
        ...(editor.value === "create"
          ? [{ key: "name", label: "名称", required: true, max: 60 }]
          : []),
        {
          key: "type",
          label: "收支类型",
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
            .filter(
              (c) =>
                c.active !== false && c.type === (form.value.type ?? "expense"),
            )
            .map((c) => ({ value: c.id, label: c.label })),
        },
        { key: "amount", label: "金额", kind: "money", required: true },
        {
          key: "accountId",
          label: "资金账户",
          kind: "select",
          options: [
            { value: "", label: "不指定账户" },
            ...accounts.value
              .filter((a) => !a.archived)
              .map((a) => ({ value: a.id, label: a.name })),
          ],
        },
        {
          key: "date",
          label: props.kind === "rules" ? "账单参考日期" : "记账日期",
          kind: "date",
        },
        { key: "note", label: "备注" },
        ...(props.kind === "rules" && editor.value === "create"
          ? ([
              {
                key: "frequency",
                label: "重复周期",
                kind: "select",
                options: [
                  { value: "week", label: "每周" },
                  { value: "month", label: "每月" },
                  { value: "year", label: "每年" },
                ],
              },
              { key: "interval", label: "每几个周期执行", kind: "number" },
              { key: "startDate", label: "开始日期", kind: "date" },
              {
                key: "endDate",
                label: "结束日期（留空不限制）",
                kind: "date",
                clearable: true,
              },
              {
                key: "mode",
                label: "执行方式",
                kind: "select",
                options: [
                  { value: "remind", label: "到期提醒（默认）" },
                  { value: "automatic", label: "自动生成账单" },
                ],
              },
            ] as LedgerFormField[])
          : []),
      ],
);
async function load() {
  rows.value = await api.get("/" + props.kind);
}
function open(mode: typeof editor.value, row?: any) {
  target.value = row;
  editor.value = mode;
  action.error.value = "";
  form.value = {
    name: "",
    type: "expense",
    category:
      categories.value.find((c) => c.type === "expense" && c.active !== false)
        ?.id ?? "",
    amount: "",
    accountId: "",
    date: localDate(),
    note: "",
    frequency: "month",
    interval: 1,
    startDate: localDate(),
    endDate: "",
    mode: "remind",
    ...(row?.bill ?? {}),
    ...(mode === "apply"
      ? { date: localDate(), accountId: row.bill.accountId ?? "" }
      : {}),
  };
}
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
async function save() {
  const v = form.value,
    bill = {
      type: v.type,
      amount: String(v.amount),
      category: v.category,
      date: v.date,
      note: v.note,
      accountId: v.accountId || null,
    };
  let path = "/" + props.kind,
    method: "POST" | "PATCH" | "DELETE" = "POST",
    body: unknown;
  if (editor.value === "delete") {
    path += `/${target.value.id}`;
    method = "DELETE";
    body = {};
  } else if (editor.value === "toggle") {
    path += `/${target.value.id}`;
    method = "PATCH";
    body = { enabled: !target.value.enabled };
  } else if (editor.value === "apply") {
    path = "/bills";
    body = bill;
  } else
    body =
      props.kind === "rules"
        ? {
            name: v.name,
            bill,
            frequency: v.frequency,
            interval: Number(v.interval),
            startDate: v.startDate,
            endDate: v.endDate || null,
            mode: v.mode,
          }
        : { name: v.name, bill };
  const result = await action.run(path, body, (k) =>
    api.write(path, body, method, k),
  );
  if (result) {
    editor.value = null;
    await load();
  }
}
onMounted(async () => {
  try {
    [categories.value, accounts.value] = await Promise.all([
      api.get("/categories"),
      api.get("/accounts"),
    ]);
    await load();
  } catch (e) {
    action.error.value = (e as Error).message;
  }
});
</script>
<template>
  <div>
    <div class="feature-toolbar">
      <h2>{{ kind === "rules" ? "周期账单" : "常用模板" }}</h2>
      <button
        v-if="canWrite"
        class="button button-primary"
        @click="open('create')"
      >
        {{ kind === "rules" ? "添加规则" : "添加模板" }}
      </button>
    </div>
    <p class="feature-hint">
      {{
        kind === "rules"
          ? "关闭应用后，后端仍会执行。自动生成只登记账单，不进行付款；权限撤销、账本归档或密码变更会暂停规则。"
          : "把常用金额、分类和账户保存为模板，使用时仍可修改，日期默认今天。"
      }}
    </p>
    <div class="feature-card">
      <div v-for="row in rows" :key="row.id" class="feature-row">
        <div>
          <strong>{{ row.name }} · {{ row.bill.amount }} 元</strong
          ><small
            >{{ row.bill.type === "income" ? "收入" : "支出" }} ·
            {{ categories.find((c) => c.id === row.bill.category)?.label
            }}<template v-if="'nextDate' in row">
              · 下次 {{ row.nextDate }} ·
              {{ row.mode === "automatic" ? "自动生成" : "到期提醒" }} ·
              {{ row.enabled ? "已启用" : "已暂停" }}</template
            ></small
          ><small
            v-if="'lastError' in row && row.lastError"
            class="feature-danger"
            >{{ row.lastError }}</small
          >
        </div>
        <div v-if="canWrite" class="feature-actions">
          <template v-if="kind === 'rules'"
            ><button @click="open('toggle', row)">
              {{ "enabled" in row && row.enabled ? "暂停" : "重新授权开启" }}
            </button></template
          ><template v-else
            ><button @click="open('apply', row)">使用</button
            ><button @click="open('delete', row)">移除</button></template
          >
        </div>
      </div>
      <p v-if="!rows.length" class="feature-empty">
        还没有{{ kind === "rules" ? "周期规则" : "常用模板" }}。
      </p>
    </div>
    <p v-if="action.success.value" class="feature-alert">
      {{ action.success.value }}
    </p>
    <p v-if="action.error.value" class="form-error">{{ action.error.value }}</p>
    <LedgerFormSheet
      v-model="form"
      :open="!!editor"
      :title="
        editor === 'apply'
          ? '使用模板记账'
          : editor === 'delete'
            ? '移除模板'
            : editor === 'toggle'
              ? '调整周期规则'
              : kind === 'rules'
                ? '添加周期规则'
                : '添加常用模板'
      "
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="
        kind === 'rules'
          ? '选择自动生成表示授权后端按规则持续记账，包括服务恢复后补生成漏掉的周期。每月日期按原始日期计算，月末会自动适配。'
          : undefined
      "
      @close="editor = null"
      @submit="save"
    />
  </div>
</template>
