<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { SheetSelect, BottomSheet } from "@t-box/ui-kit";
import { featureApi, useFeatureAction } from "./api";
import AttachmentButton from "./AttachmentButton.vue";
import LedgerFormSheet from "./LedgerFormSheet.vue";
import type { FormValues, LedgerFormField } from "./form";
import { localDate } from "../bills/format";
const props = defineProps<{
    ledgerId: string;
    canWrite: boolean;
    canManage: boolean;
  }>(),
  api = featureApi(props.ledgerId),
  action = useFeatureAction(),
  rows = ref<any[]>([]),
  aging = ref<any[]>([]),
  bucket = ref("all"),
  contact = ref(""),
  editor = ref<"create" | "edit" | "adjust" | null>(null),
  target = ref<any>(),
  historyTarget = ref<any>(),
  adjustments = ref<any[]>([]),
  allAdjustments = ref<any[]>([]),
  reverseTarget = ref<any>(),
  attachmentResourceIds = ref<string[]>([]),
  form = ref<FormValues>({});
const visible = computed(() =>
  aging.value.filter(
    (r) =>
      (bucket.value === "all" || r.bucket === bucket.value) &&
      (!contact.value || r.contactId === contact.value),
  ),
);
const fields = computed<LedgerFormField[]>(() =>
  editor.value === "adjust"
    ? [
        {
          key: "kind",
          label: "调整方式",
          kind: "select",
          options: [
            { value: "extension", label: "展期" },
            { value: "waiver", label: "减免" },
            { value: "writeoff", label: "核销" },
          ],
        },
        ...((form.value.kind === "extension"
          ? [{ key: "dueDate", label: "新的到期日", kind: "date" }]
          : [
              {
                key: "amount",
                label: "调整金额",
                kind: "money",
                required: true,
              },
              { key: "date", label: "调整日期", kind: "date" },
            ]) as LedgerFormField[]),
        { key: "note", label: "调整原因", required: true },
      ]
    : [
        { key: "name", label: "对象名称", required: true, max: 80 },
        { key: "note", label: "备注" },
        ...(editor.value === "edit"
          ? ([
              { key: "archived", label: "归档对象", kind: "checkbox" },
            ] as LedgerFormField[])
          : []),
      ],
);
async function load() {
  [rows.value, aging.value, allAdjustments.value] = await Promise.all([
    api.get("/contacts"),
    api.get("/debts/aging"),
    api.get("/debt-adjustments"),
  ]);
}
function open(mode: typeof editor.value, row?: any) {
  attachmentResourceIds.value = [];
  editor.value = mode;
  target.value = row;
  action.error.value = "";
  form.value =
    mode === "adjust"
      ? {
          kind: "extension",
          amount: row.remaining,
          date: localDate(),
          dueDate: row.dueDate ?? localDate(),
          note: "",
        }
      : {
          name: row?.name ?? "",
          note: row?.note ?? "",
          ...(mode === "edit" ? { archived: !!Number(row.archived) } : {}),
        };
}
async function save() {
  const mode = editor.value,
    path =
      mode === "adjust"
        ? `/debts/${target.value.id}/adjustments`
        : mode === "edit"
          ? `/contacts/${target.value.id}`
          : "/contacts",
    body =
      mode === "adjust"
        ? {
            ...form.value,
            attachmentResourceIds: attachmentResourceIds.value,
            amount:
              form.value.kind === "extension"
                ? null
                : String(form.value.amount),
            date: form.value.kind === "extension" ? null : form.value.date,
            dueDate:
              form.value.kind === "extension" ? form.value.dueDate : null,
          }
        : form.value;
  const result = await action.run(path, body, (k) =>
    api.write(path, body, mode === "edit" ? "PATCH" : "POST", k),
  );
  if (result) {
    editor.value = null;
    await load();
  }
}
async function history(row: any) {
  historyTarget.value = row;
  try {
    adjustments.value = await api.get(`/debts/${row.id}/adjustments`);
  } catch (e) {
    action.error.value = (e as Error).message;
  }
}
async function reverse() {
  const path = `/debt-adjustments/${reverseTarget.value.id}/reversal`;
  const r = await action.run(path, {}, (k) => api.write(path, {}, "POST", k));
  if (r) {
    reverseTarget.value = undefined;
    await load();
    if (historyTarget.value) await history(historyTarget.value);
  }
}
onMounted(() => load().catch((e) => (action.error.value = e.message)));
</script>
<template>
  <div>
    <div class="feature-toolbar">
      <h2>往来对象与账龄</h2>
      <button
        v-if="canWrite"
        class="button button-primary"
        @click="open('create')"
      >
        添加对象
      </button>
    </div>
    <div class="feature-card">
      <div v-for="row in rows" :key="row.id" class="feature-row">
        <div>
          <strong
            >{{ row.name }}{{ Number(row.archived) ? " · 已归档" : "" }}</strong
          ><small>应收 {{ row.receivable }} · 应付 {{ row.payable }} 元</small>
        </div>
        <div class="feature-actions">
          <button @click="contact = contact === row.id ? '' : row.id">
            {{ contact === row.id ? "查看全部" : "明细" }}</button
          ><button v-if="canManage" @click="open('edit', row)">编辑</button>
        </div>
      </div>
      <p v-if="!rows.length" class="feature-empty">
        创建对象后，可归集同名的历史往来。
      </p>
    </div>
    <SheetSelect
      v-model="bucket"
      label="选择账龄"
      :options="[
        { value: 'all', label: '全部未结往来' },
        { value: 'not_due', label: '未到期 / 未设到期日' },
        { value: '1_30', label: '逾期 1–30 天' },
        { value: '31_90', label: '逾期 31–90 天' },
        { value: 'over_90', label: '逾期超过 90 天' },
      ]"
    />
    <div class="feature-card">
      <div v-for="row in visible" :key="row.id" class="feature-row">
        <div>
          <strong
            >{{ row.counterparty }} ·
            {{ row.direction === "receivable" ? "应收" : "应付" }}
            {{ row.remaining }} 元</strong
          ><small
            >{{ row.dueDate ? "到期 " + row.dueDate : "未设到期日"
            }}{{
              Number(row.overdueDays) > 0
                ? " · 逾期 " + row.overdueDays + " 天"
                : ""
            }}</small
          ><small v-if="Number(row.adjusted) > 0"
            >累计减免 / 核销 {{ row.adjusted }} 元</small
          >
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="debt"
            :record-id="row.id"
            :can-write="canManage"
          />
          <button v-if="canManage" @click="history(row)">调整记录</button
          ><button v-if="canManage" @click="open('adjust', row)">调整</button>
        </div>
      </div>
      <p v-if="!visible.length" class="feature-empty">
        没有符合条件的未结往来。
      </p>
    </div>
    <details class="feature-card">
      <summary class="feature-section-title">
        减免与核销记录（包含已结清）
      </summary>
      <div v-for="r in allAdjustments" :key="r.id" class="feature-row">
        <div>
          <strong
            >{{ r.counterparty }} · {{ r.kind === "waiver" ? "减免" : "核销" }}
            {{ r.amount }} 元{{ Number(r.reversed) ? " · 已撤销" : "" }}</strong
          ><small>{{ r.date }} · {{ r.note }}</small>
        </div>
        <div class="feature-actions">
          <AttachmentButton
            :ledger-id="ledgerId"
            kind="debt-adjustment"
            :record-id="r.id"
            :can-write="canManage"
          />
          <button
            v-if="canManage && !Number(r.reversed)"
            @click="reverseTarget = r"
          >
            撤销误记
          </button>
        </div>
      </div>
      <p v-if="!allAdjustments.length" class="feature-empty">暂无调整记录。</p>
    </details>
    <p v-if="action.error.value" class="form-error">{{ action.error.value }}</p>
    <LedgerFormSheet
      v-model="form"
      v-model:attachment-resource-ids="attachmentResourceIds"
      :ledger-id="ledgerId"
      :attachments="editor === 'adjust'"
      :open="!!editor"
      :title="
        editor === 'adjust'
          ? '调整往来'
          : editor === 'edit'
            ? '编辑往来对象'
            : '添加往来对象'
      "
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="
        editor === 'adjust'
          ? '减免和核销只减少剩余往来，不产生收还款或资金流水。'
          : undefined
      "
      @close="editor = null"
      @submit="save"
    />
    <BottomSheet
      :open="!!historyTarget"
      title="往来调整记录"
      full-height
      compact
      @close="historyTarget = undefined"
      ><div v-for="r in adjustments" :key="r.id" class="feature-row">
        <div>
          <strong
            >{{ r.kind === "waiver" ? "减免" : "核销" }} {{ r.amount }} 元{{
              Number(r.reversed) ? " · 已撤销" : ""
            }}</strong
          ><small>{{ r.date }} · {{ r.note }}</small>
        </div>
        <div class="feature-actions">
          <button
            v-if="canManage && !Number(r.reversed)"
            @click="reverseTarget = r"
          >
            撤销误记
          </button>
        </div>
      </div>
      <p v-if="!adjustments.length" class="feature-empty">
        暂无减免、核销记录，展期记录保留在操作日志。
      </p></BottomSheet
    >
    <LedgerFormSheet
      v-model="form"
      :open="!!reverseTarget"
      title="撤销调整"
      :fields="[]"
      :busy="action.busy.value"
      :error="action.error.value"
      description="剩余应收或应付将恢复，本操作不产生收还款及资金流水。"
      @close="reverseTarget = undefined"
      @submit="reverse"
    />
  </div>
</template>
