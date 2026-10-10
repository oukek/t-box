<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from "vue";
import { AppIcon } from "@t-box/ui-kit";
const props = defineProps<{
    ledgerId: string;
    canWrite: boolean;
    canManage: boolean;
    template: string;
  }>(),
  selected = ref("");
const entries = [
  {
    id: "batch",
    name: "批量记录",
    icon: "plus",
    component: defineAsyncComponent(() => import("./BatchPanel.vue")),
  },
  {
    id: "categories",
    name: "分类管理",
    icon: "apps",
    component: defineAsyncComponent(() => import("./CategoriesPanel.vue")),
  },
  {
    id: "accounts",
    name: "资金账户",
    icon: "wallet",
    component: defineAsyncComponent(() => import("./AccountsPanel.vue")),
  },
  {
    id: "budgets",
    name: "预算",
    icon: "calculator",
    component: defineAsyncComponent(() => import("./BudgetsPanel.vue")),
  },
  {
    id: "rules",
    name: "周期账单",
    icon: "clock",
    component: defineAsyncComponent(() => import("./PlanningPanel.vue")),
  },
  {
    id: "templates",
    name: "常用模板",
    icon: "file",
    component: defineAsyncComponent(() => import("./PlanningPanel.vue")),
  },
  {
    id: "contacts",
    name: "往来与账龄",
    icon: "user",
    component: defineAsyncComponent(() => import("./ContactsPanel.vue")),
  },
  {
    id: "reimbursements",
    name: "报销",
    icon: "exchange",
    component: defineAsyncComponent(() => import("./ReimbursementsPanel.vue")),
  },
  {
    id: "imports",
    name: "导入 / 导出",
    icon: "attach",
    component: defineAsyncComponent(() => import("./ImportExportPanel.vue")),
  },
  {
    id: "trash",
    name: "回收站",
    icon: "trash",
    component: defineAsyncComponent(() => import("./TrashPanel.vue")),
  },
  {
    id: "notices",
    name: "账本提醒",
    icon: "info",
    component: defineAsyncComponent(() => import("./NoticesPanel.vue")),
  },
];
const visible = computed(() =>
    entries.filter((e) =>
      props.template === "debt"
        ? ![
            "categories",
            "budgets",
            "rules",
            "templates",
            "reimbursements",
            "trash",
          ].includes(e.id)
        : props.template === "daily"
          ? e.id !== "contacts"
          : true,
    ),
  ),
  current = computed(() => visible.value.find((e) => e.id === selected.value));
defineExpose({
  back: () => {
    selected.value = "";
  },
  hasSelection: computed(() => !!current.value),
});
</script>
<template>
  <section class="ledger-tools">
    <template v-if="current">
      <component
        :is="current.component"
        :ledger-id="ledgerId"
        :can-write="canWrite"
        :can-manage="canManage"
        :template="template"
        :kind="current.id"
    /></template>
    <div v-else class="feature-grid">
      <button
        v-for="entry in visible"
        :key="entry.id"
        @click="selected = entry.id"
      >
        <AppIcon :name="entry.icon" :size="21" /><span>{{ entry.name }}</span>
      </button>
    </div>
  </section>
</template>
