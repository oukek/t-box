<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type {
  AgentWorkflowConfiguration,
  AgentWorkflowPrompts,
} from "@t-box/shared";
import { request, save, errorMessage } from "../core/api";
import AdminDialog from "../components/AdminDialog.vue";
const stages = [
  {
    key: "analysis",
    title: "需求分析与计划",
    description: "复杂推演或工具任务按需启用；选择应用能力并保存计划。",
  },
  {
    key: "execution",
    title: "任务处理",
    description: "按计划调用技能、专业 Agent 和工具，等待必要的前端操作。",
  },
  {
    key: "review",
    title: "结果核对",
    description: "核对真实回执与缺项，决定继续处理、提问或结束。",
  },
  {
    key: "answer",
    title: "最终回复",
    description: "简单问题直接回复；复杂任务基于核对结果总结并收起处理过程。",
  },
] as const;
const config = ref<AgentWorkflowConfiguration>();
const loading = ref(false),
  busy = ref(false),
  open = ref(false),
  error = ref(""),
  formError = ref("");
const selected = ref<keyof AgentWorkflowPrompts>("analysis");
const form = reactive<AgentWorkflowPrompts>({
  analysis: "",
  execution: "",
  review: "",
  answer: "",
});
const revision = ref(0);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    config.value = await request<AgentWorkflowConfiguration>("/workflow");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function edit(key: keyof AgentWorkflowPrompts) {
  if (!config.value) return;
  Object.assign(form, config.value.prompts);
  revision.value = config.value.revision;
  selected.value = key;
  formError.value = "";
  open.value = true;
}
async function restore() {
  busy.value = true;
  formError.value = "";
  try {
    const defaults = await request<AgentWorkflowPrompts>("/workflow/defaults");
    form[selected.value] = defaults[selected.value];
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  formError.value = "";
  try {
    config.value = await save<AgentWorkflowConfiguration>(
      "/workflow",
      { revision: revision.value, prompts: form },
      "PATCH",
    );
    open.value = false;
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
      <p class="eyebrow">AGENT WORKFLOW</p>
      <h1>分析流程</h1>
      <p>控制 AI 如何理解、执行与核对任务，默认 Prompt 已接入。</p>
    </div>
    <button :disabled="loading" @click="load">刷新</button>
  </header>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section class="panel workflow-intro">
    <div>
      <span class="badge" v-if="config">版本 {{ config.revision }}</span>
      <h2>简单问题直接回复，复杂任务按需规划</h2>
      <p class="muted">
        首次模型请求按语义选择直接回复或提交计划。普通问答、简单计算和必要追问可在同一次请求中完成；复杂推演与工具任务才规划，实际工具操作仍执行并核对回执。公开的是简短行动说明，不显示模型内部推理。
      </p>
    </div>
    <p class="muted">
      修改对新任务生效。执行中的任务及继续任务使用原版本，应用业务规则由应用自己的技能提供。
    </p>
  </section>
  <div v-if="loading" class="empty">正在读取分析流程…</div>
  <div v-else-if="config" class="workflow-grid">
    <section
      v-for="(stage, index) in stages"
      :key="stage.key"
      class="panel stage-card"
    >
      <div class="panel-heading">
        <span class="stage-number">0{{ index + 1 }}</span>
        <h2>{{ stage.title }}</h2>
        <button @click="edit(stage.key)">编辑 Prompt</button>
      </div>
      <p class="muted">{{ stage.description }}</p>
      <pre>{{ config.prompts[stage.key] }}</pre>
    </section>
  </div>
  <AdminDialog
    :open="open"
    :busy="busy"
    title="编辑阶段 Prompt"
    description="权限、阶段工具限制、幂等与真实回执检查由后端执行器独立保证。"
    @close="open = false"
  >
    <form id="workflow-form" @submit.prevent="submit">
      <fieldset :disabled="busy">
        <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
        <label
          >{{ stages.find((s) => s.key === selected)?.title
          }}<textarea
            v-model="form[selected]"
            required
            minlength="20"
            maxlength="12000"
            rows="16"
            spellcheck="false"
          />
        </label>
        <p class="muted">各阶段调用均按实际 token 计费；标题生成仍不收费。</p>
      </fieldset>
    </form>
    <template #footer
      ><button :disabled="busy" @click="restore">填入默认 Prompt</button
      ><button :disabled="busy" @click="open = false">取消</button
      ><button
        class="primary"
        type="submit"
        form="workflow-form"
        :disabled="busy"
      >
        {{ busy ? "保存中…" : "发布新版本" }}
      </button></template
    >
  </AdminDialog>
</template>
<style scoped>
.workflow-intro {
  padding: 22px;
  margin-bottom: 20px;
  display: flex;
  gap: 32px;
  align-items: center;
}
.workflow-intro h2 {
  font-size: 17px;
  margin: 12px 0;
}
.workflow-intro p {
  line-height: 1.8;
  max-width: 650px;
}
.workflow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.stage-card {
  padding: 20px;
  min-width: 0;
}
.stage-card .panel-heading {
  padding: 0;
  gap: 10px;
}
.stage-card h2 {
  font-size: 15px;
  flex: 1;
}
.stage-number {
  color: #7b998e;
  font-size: 12px;
}
.stage-card p {
  font-size: 12px;
  line-height: 1.7;
}
.stage-card pre {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.9;
  background: #f7f9f8;
  border-radius: 8px;
  padding: 14px;
  color: #60756a;
  margin: 16px 0 0;
}
textarea {
  width: 100%;
  resize: vertical;
  line-height: 1.8;
  font-size: 13px;
}
@media (max-width: 900px) {
  .workflow-grid {
    grid-template-columns: 1fr;
  }
  .workflow-intro {
    display: block;
  }
}
</style>
