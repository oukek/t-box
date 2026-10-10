<script setup lang="ts">
import { ref, watch } from "vue";
import type { TaskSummary, TaskToolRecord } from "@t-box/shared";
import { SidePanel } from "@t-box/ui-kit";
import { Modal } from "@t-box/ui-kit";
import { AppIcon } from "@t-box/ui-kit";
import { navigateTab } from "../../core/navigation";
import { request } from "../../core/network";
import { authorizeResources } from "../../applications/registry";
import {
  chatState,
  chatBusy,
  resumeTask,
  endTask,
  openConversation,
} from "./chatStore";
const props = defineProps<{ open: boolean }>(),
  emit = defineEmits<{ close: [] }>();
const items = ref<TaskSummary[]>([]),
  tools = ref<(TaskToolRecord & { title?: string })[]>([]),
  selected = ref<string>("");
const loading = ref(false),
  error = ref(""),
  confirmEnd = ref(false);
const labels = {
  queued: "等待继续",
  running: "正在处理",
  waiting_client: "等待你处理",
  paused: "已暂停",
  needs_review: "需要核对",
  completed: "已完成",
  cancelled: "已结束",
};
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
let revision = 0;
let detailRevision = 0;
watch(
  () => props.open,
  async (open) => {
    const rev = ++revision;
    if (!open) return;
    loading.value = true;
    error.value = "";
    selected.value = "";
    tools.value = [];
    try {
      const result = await request<{ data: TaskSummary[] }>("/tasks");
      if (rev === revision) items.value = result.data;
    } catch (cause) {
      if (rev === revision)
        error.value = cause instanceof Error ? cause.message : "读取任务失败";
    } finally {
      if (rev === revision) loading.value = false;
    }
  },
);
async function details(task: TaskSummary) {
  selected.value = task.id;
  tools.value = [];
  error.value = "";
  loading.value = true;
  const rev = revision;
  const detailRev = ++detailRevision;
  try {
    if (task.unavailable) throw new Error("此任务涉及的应用资源已不可访问");
    if (
      !(await authorizeResources(task.protectedResources || [], "查看任务记录"))
    )
      return;
    const result = await request<{ data: { tools: TaskToolRecord[] } }>(
      `/tasks/${task.id}`,
    );
    if (
      rev === revision &&
      detailRev === detailRevision &&
      selected.value === task.id
    )
      tools.value = result.data.tools;
  } catch (cause) {
    if (rev === revision && detailRev === detailRevision)
      error.value = cause instanceof Error ? cause.message : "读取记录失败";
  } finally {
    if (rev === revision && detailRev === detailRevision) loading.value = false;
  }
}
async function resume() {
  error.value = "";
  try {
    const refs = chatState.messages.flatMap((m) => m.resourceRefs || []);
    if (!(await authorizeResources(refs, "继续任务"))) return;
    if (resumeTask()) emit("close");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "任务暂不能继续";
  }
}
async function showConversation(task: TaskSummary) {
  try {
    if (task.unavailable) throw new Error("此任务涉及的应用资源已不可访问");
    if (
      !(await authorizeResources(task.protectedResources || [], "打开任务会话"))
    )
      return;
    if (openConversation(task.conversationId)) {
      navigateTab("home");
      emit("close");
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "打开任务会话失败";
  }
}
function stop() {
  if (endTask()) {
    confirmEnd.value = false;
    emit("close");
  }
}
</script>
<template>
  <SidePanel :open="open" title="任务记录" @close="emit('close')">
    <p class="panel-caption">查看处理进度和已完成的操作。</p>
    <p v-if="error" class="task-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="panel-caption" role="status">正在读取…</p>
    <p v-else-if="!items.length" class="panel-caption">
      还没有任务，发送消息后会保留处理记录。
    </p>
    <ol class="task-list">
      <li v-for="task in items" :key="task.id">
        <button
          class="task-row"
          :aria-expanded="selected === task.id"
          @click="details(task)"
        >
          <AppIcon
            :name="
              task.status === 'completed'
                ? 'check'
                : task.status === 'needs_review'
                  ? 'warning'
                  : 'history'
            "
            :size="18"
          />
          <span
            ><strong>{{ task.title || "对话任务" }}</strong
            ><small
              >{{ task.agentTitle || "助手" }} ·
              {{ date(task.updatedAt) }}</small
            ></span
          ><small class="task-status">{{ labels[task.status] }}</small>
          <AppIcon name="right" :size="14" />
        </button>
        <div v-if="selected === task.id" class="task-detail">
          <p v-if="task.reason">{{ task.reason }}</p>
          <ol v-if="tools.length" class="task-tools">
            <li v-for="tool in tools" :key="tool.callId">
              <span>{{ tool.title || tool.name }}</span
              ><small>{{
                tool.status === "completed"
                  ? tool.result?.ok
                    ? "已完成"
                    : "未完成"
                  : tool.effect === "write" || tool.effect === "external"
                    ? "请核对结果"
                    : "已中断"
              }}</small>
            </li>
          </ol>
          <p v-else-if="!loading">尚无工具执行记录。</p>
          <button
            class="task-link"
            :disabled="chatBusy"
            @click="showConversation(task)"
          >
            打开所属对话
          </button>
        </div>
      </li>
    </ol>
    <template
      #footer
      v-if="
        chatState.task &&
        ['queued', 'paused', 'waiting_client', 'needs_review'].includes(
          chatState.task.status,
        )
      "
    >
      <p class="panel-caption">
        {{
          chatState.task.status === "needs_review"
            ? "部分操作结果尚未确认，请先查看对应应用。结束任务不会撤销已完成操作。"
            : chatState.task.status === "waiting_client"
              ? "任务正在等待页面操作、确认或授权。继续后会重新发起交互。"
              : "当前对话已暂停，可以继续。涉及授权或确认的操作会重新询问。"
        }}
      </p>
      <div class="task-actions">
        <button
          v-if="chatState.task.status !== 'needs_review'"
          class="button button-primary"
          :disabled="chatBusy || chatState.connection !== 'connected'"
          @click="resume"
        >
          继续任务
        </button>
        <button
          class="button button-secondary"
          :disabled="chatBusy || chatState.connection !== 'connected'"
          @click="confirmEnd = true"
        >
          {{
            chatState.task.status === "needs_review"
              ? "已核对，结束任务"
              : "结束任务"
          }}
        </button>
      </div>
    </template>
  </SidePanel>
  <Modal :open="confirmEnd" title="结束此任务？" @close="confirmEnd = false">
    <p class="panel-caption">
      已完成的操作会保留，尚未执行的步骤将停止。请确认已核对操作结果。
    </p>
    <div class="task-actions">
      <button class="button button-secondary" @click="confirmEnd = false">
        返回</button
      ><button class="button button-primary" @click="stop">确认结束</button>
    </div>
  </Modal>
</template>
<style scoped>
.panel-caption {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.task-error {
  font-size: 13px;
  color: #a35039;
  line-height: 1.6;
}
.task-list,
.task-tools {
  padding: 0;
  margin: 0;
  list-style: none;
}
.task-list > li {
  border-bottom: 1px solid #e8eded;
}
.task-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 7px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--ink);
}
.task-row > span {
  flex: 1;
  min-width: 0;
}
.task-row strong {
  display: block;
  font-size: 13px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-row > .task-status {
  margin: 0;
  font-size: 11px;
  white-space: nowrap;
}
.task-row small {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  color: var(--muted);
}
.task-detail {
  padding: 0 8px 16px 37px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.task-tools li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0;
}
.task-tools small {
  white-space: nowrap;
}
.task-link {
  padding: 6px 0;
  margin-top: 8px;
  color: #357c75;
  border: 0;
  background: transparent;
  font-size: 12px;
}
.task-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.task-actions .button {
  flex: 1;
  white-space: nowrap;
}
</style>
