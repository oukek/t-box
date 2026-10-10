<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import CategoryDialog from "../categories/CategoryDialog.vue";
import CategoryIcon from "../categories/CategoryIcon.vue";
import { SheetSelect } from "@t-box/ui-kit";
import type { ManagedCategory } from "@t-box/ledger-contracts";
import { featureApi, useFeatureAction } from "./api";
import LedgerFormSheet from "./LedgerFormSheet.vue";
import type { FormValues, LedgerFormField } from "./form";
const props = defineProps<{ ledgerId: string; canManage: boolean }>(),
  api = featureApi(props.ledgerId),
  action = useFeatureAction(),
  rows = ref<ManagedCategory[]>([]),
  type = ref<"expense" | "income">("expense"),
  editor = ref<"create" | "edit" | "merge" | "delete" | null>(null),
  target = ref<ManagedCategory>(),
  form = ref<FormValues>({});
const visible = computed(() => rows.value.filter((r) => r.type === type.value));
const fields = computed<LedgerFormField[]>(() =>
  editor.value === "merge"
    ? [
        {
          key: "targetId",
          label: "合并到",
          kind: "select",
          options: rows.value
            .filter(
              (r) =>
                r.type === target.value?.type &&
                r.id !== target.value?.id &&
                r.active,
            )
            .map((r) => ({ value: r.id, label: r.label })),
        },
      ]
    : [],
);
function create() {
  target.value = undefined;
  editor.value = "create";
  action.error.value = "";
}
async function load() {
  try {
    rows.value = await api.get("/categories");
  } catch (e) {
    action.error.value = e instanceof Error ? e.message : "分类读取失败";
  }
}
function open(row: ManagedCategory, mode: "edit" | "merge" | "delete") {
  if (row.isDefault) return;
  target.value = row;
  editor.value = mode;
  form.value = { targetId: "" };
  action.error.value = "";
}
async function save() {
  const row = target.value;
  if (!row || (editor.value !== "merge" && editor.value !== "delete")) return;
  const mode = editor.value;
  const body = mode === "merge" ? { targetId: form.value.targetId } : {};
  const result = await action.run(
    `category:${mode}:${row?.id ?? "new"}`,
    body,
    (key) =>
      api.write(
        `/categories/${row.id}${mode === "merge" ? "/merge" : ""}`,
        body,
        mode === "delete" ? "DELETE" : "POST",
        key,
      ),
  );
  if (result) {
    editor.value = null;
    await load();
  }
}
onMounted(() => load().catch((e) => (action.error.value = e.message)));
</script>
<template>
  <div>
    <div class="feature-toolbar">
      <h2>分类管理</h2>
      <button v-if="canManage" class="button button-primary" @click="create">
        添加自定义分类
      </button>
      <SheetSelect
        v-model="type"
        label="选择收支类型"
        :options="[
          { value: 'expense', label: '支出' },
          { value: 'income', label: '收入' },
        ]"
      />
    </div>
    <p class="feature-hint">
      系统分类由管理后台统一维护；账本内可添加、编辑或合并自定义分类，停用后保留历史。
    </p>
    <div class="feature-card">
      <div v-for="row in visible" :key="row.id" class="feature-row">
        <CategoryIcon
          :ledger-id="ledgerId"
          :icon="row.icon"
          :icon-id="row.iconId"
          :size="18"
        />
        <div>
          <strong>{{ row.label }}</strong
          ><small
            >{{ row.isDefault ? "系统分类 · " : "自定义 · "
            }}{{ row.active ? "已启用" : "已停用"
            }}{{ row.pinned ? " · 置顶" : "" }}</small
          >
        </div>
        <div v-if="canManage && !row.isDefault" class="feature-actions">
          <button @click="open(row, 'edit')">编辑</button
          ><button @click="open(row, 'merge')">合并</button
          ><button class="feature-danger" @click="open(row, 'delete')">
            删除
          </button>
        </div>
      </div>
    </div>
    <p v-if="action.error.value" class="form-error">{{ action.error.value }}</p>
    <CategoryDialog
      :open="editor === 'create' || editor === 'edit'"
      :ledger-id="ledgerId"
      :type="type"
      :category="editor === 'edit' ? target : undefined"
      @close="editor = null"
      @saved="load"
    />
    <LedgerFormSheet
      v-model="form"
      :open="editor === 'merge' || editor === 'delete'"
      :title="editor === 'merge' ? '合并分类' : '删除分类'"
      :fields="fields"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="
        editor === 'merge'
          ? '确认后，原分类的全部历史记录归入目标分类，原分类停用。'
          : editor === 'delete'
            ? '仅未被账单、预算或规则引用的分类可以删除；已使用的分类请停用。'
            : undefined
      "
      @close="editor = null"
      @submit="save"
    />
  </div>
</template>
