<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { CategoryPreset } from "@t-box/ledger-contracts";
import { request, save, errorMessage } from "../core/api";
import AdminDialog from "../components/AdminDialog.vue";
import AdminSelect from "../components/AdminSelect.vue";
const rows = ref<CategoryPreset[]>([]),
  loading = ref(false),
  busy = ref(false),
  open = ref(false),
  error = ref(""),
  formError = ref("");
const filter = ref("expense"),
  target = ref<CategoryPreset>();
const form = reactive({
  type: "expense",
  label: "",
  icon: "other",
  active: true,
  sortOrder: 100,
});
const types = [
  { value: "expense", label: "支出" },
  { value: "income", label: "收入" },
];
const icons = [
  ["food", "餐饮"],
  ["transport", "交通"],
  ["shopping", "购物"],
  ["housing", "居家"],
  ["entertainment", "娱乐"],
  ["health", "医疗"],
  ["salary", "工资"],
  ["bonus", "礼金"],
  ["wallet", "钱包"],
  ["clock", "时间"],
  ["file", "文件"],
  ["other", "其他"],
].map(([value, label]) => ({ value: value!, label: label! }));
const visible = computed(() =>
  rows.value.filter((r) => r.type === filter.value),
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    rows.value = await request<CategoryPreset[]>("/ledger/category-presets");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function edit(row?: CategoryPreset) {
  target.value = row;
  Object.assign(
    form,
    row ?? {
      type: filter.value,
      label: "",
      icon: "other",
      active: true,
      sortOrder: 100,
    },
  );
  formError.value = "";
  open.value = true;
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  formError.value = "";
  try {
    const { label, icon, active, sortOrder } = form;
    await save(
      "/ledger/category-presets" + (target.value ? `/${target.value.id}` : ""),
      target.value
        ? { label, icon, active, sortOrder, revision: target.value.revision }
        : { label, icon, active, sortOrder, type: form.type },
      target.value ? "PATCH" : "POST",
    );
    open.value = false;
    await load();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">LEDGER / CATEGORIES</p>
      <h1>记账系统分类</h1>
      <p>统一维护收入、支出分类。用户在账本内管理自己的自定义分类。</p>
    </div>
    <div class="actions">
      <button class="primary" :disabled="loading" @click="edit()">
        新增系统分类</button
      ><button :disabled="loading" @click="load">刷新</button>
    </div>
  </header>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section class="panel">
    <div class="panel-heading">
      <h2>{{ filter === "expense" ? "支出分类" : "收入分类" }}</h2>
      <div class="type-filter">
        <AdminSelect v-model="filter" label="收支类型" :options="types" />
      </div>
    </div>
    <p class="category-note">
      保存后同步到现有及新建账本。收支类型创建后不可更改；停用不会删除历史账单。
    </p>
    <p v-if="loading" class="empty">正在读取系统分类…</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>分类名称</th>
            <th>图标</th>
            <th>排序</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id">
            <td>
              <strong>{{ row.label }}</strong>
            </td>
            <td>
              {{ icons.find((i) => i.value === row.icon)?.label ?? row.icon }}
            </td>
            <td>{{ row.sortOrder }}</td>
            <td>
              <span class="badge" :class="{ disabled: !row.active }">{{
                row.active ? "已启用" : "已停用"
              }}</span>
            </td>
            <td><button @click="edit(row)">编辑</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!visible.length" class="empty">暂无系统分类</p>
    </div>
  </section>
  <AdminDialog
    :open="open"
    :title="target ? '编辑系统分类' : '新增系统分类'"
    description="修改会同步到所有账本；分类标识及历史记录关联保持不变。"
    :busy="busy"
    @close="open = false"
  >
    <form id="category-preset-form" @submit.prevent="submit">
      <fieldset :disabled="busy">
        <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
        <label
          >收支类型<AdminSelect
            v-model="form.type"
            label="收支类型"
            :options="types"
            :disabled="!!target || busy"
            required
        /></label>
        <label
          >分类名称<input v-model="form.label" maxlength="40" required
        /></label>
        <label
          >分类图标<AdminSelect
            v-model="form.icon"
            label="分类图标"
            :options="icons"
            required
        /></label>
        <label
          >排序（越小越靠前）<input
            v-model.number="form.sortOrder"
            type="number"
            min="0"
            max="100000"
            step="1"
            required
        /></label>
        <label class="category-enabled"
          ><input v-model="form.active" type="checkbox" />启用分类</label
        >
      </fieldset>
    </form>
    <template #footer
      ><button :disabled="busy" @click="open = false">取消</button
      ><button
        class="primary"
        type="submit"
        form="category-preset-form"
        :disabled="busy"
      >
        {{ busy ? "正在同步…" : "保存并同步" }}
      </button></template
    >
  </AdminDialog>
</template>
<style scoped>
.type-filter {
  width: 130px;
}
.category-note {
  margin: 0;
  padding: 16px 24px;
  color: #6d7d78;
  font-size: 13px;
  line-height: 1.7;
  border-bottom: 1px solid #edf1ef;
}
.category-enabled {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}
.category-enabled input {
  width: auto;
}
</style>
