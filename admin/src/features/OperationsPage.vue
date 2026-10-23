<script setup lang="ts">
import type { OperationsEvent, OperationsOverview } from '@t-box/shared'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { errorMessage, request } from '../core/api'
import OperationsRecords from './OperationsRecords.vue'

const overview = ref<OperationsOverview | null>(null)
const events = ref<OperationsEvent[]>([])
const records = ref<InstanceType<typeof OperationsRecords>>()
const taskId = ref('')
const error = ref('')
const busy = ref(false)
let alive = true
const labels: Record<string, string> = {
  queued: '排队',
  running: '执行中',
  paused: '暂停',
  waiting_client: '等待用户',
  needs_review: '待核对',
  completed: '完成',
  cancelled: '结束',
}
const alerts = computed(() => {
  const data = overview.value
  if (!data) {
    return []
  }
  const items: string[] = []
  if (data.errors) {
    items.push(
      `近 24 小时记录 ${data.errors} 次异常，可通过任务 ID 或请求 ID 定位。`,
    )
  }
  if (data.usage.unresolved) {
    items.push(
      `${data.usage.unresolved} 次模型调用尚未结清或用量待核对，请到用户与余额查看。`,
    )
  }
  if (data.expiredPayments) {
    items.push(
      `${data.expiredPayments} 笔超时订单未确认关闭或支付，请到支付订单核对。`,
    )
  }
  return items
})
async function load() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const [data, rows] = await Promise.all([
      request<OperationsOverview>('/operations'),
      request<OperationsEvent[]>('/operations/events'),
    ])
    if (alive) {
      overview.value = data
      events.value = rows
    }
  } catch (e) {
    if (alive) {
      error.value = errorMessage(e)
    }
  } finally {
    busy.value = false
  }
  void records.value?.refresh()
}
function inspect(id = taskId.value.trim()) {
  if (id) {
    void records.value?.inspectTask(id)
  }
}
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false })
onMounted(load)
onBeforeUnmount(() => (alive = false))
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">OPERATIONS</p>
      <h1>任务与运行记录</h1>
      <p>追踪任务、逐次模型请求、消耗与失败原因。</p>
    </div>
    <button :disabled="busy" @click="load">
      {{ busy ? '刷新中…' : '刷新' }}
    </button>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >{{ error }}</p>
  <template v-if="overview">
    <div class="metrics">
      <article>
        <span>模型调用 · 近 24 小时</span><strong>{{ overview.usage.calls }}</strong><small>记录成本 ¥{{ overview.usage.cost }}</small>
      </article>
      <article>
        <span>实际扣额度 · 近 24 小时</span><strong>{{ overview.usage.charged }}</strong><small>免费用户也计入模型成本</small>
      </article>
      <article>
        <span>自动续办队列</span><strong>{{ overview.recoveryBacklog }}</strong><small>等待前端和待核对写入不会自动执行</small>
      </article>
      <article>
        <span>资源存储</span><strong>{{ (Number(overview.resources.bytes) / 1024 / 1024).toFixed(1) }}
          <em>MB</em></strong><small>{{ overview.resources.files }} 个文件</small>
      </article>
    </div>
    <div class="task-states">
      <span
        v-for="item in overview.tasks"
        :key="item.status"
      >{{ labels[item.status] || item.status }}<b>{{ item.count }}</b></span><span v-if="!overview.tasks.length">近 24 小时暂无任务</span>
    </div>
    <div v-if="alerts.length" class="warnings">
      <p v-for="item in alerts" :key="item">{{ item }}</p>
    </div>
  </template>
  <form class="lookup" @submit.prevent="inspect()">
    <label for="operation-task">定位任务</label><input
      id="operation-task"
      v-model="taskId"
      placeholder="输入任务 ID"
      autocomplete="off"
    ><button :disabled="!taskId.trim()">查看执行记录</button>
  </form>
  <OperationsRecords ref="records" />
  <section class="panel">
    <div class="section-heading">
      <div>
        <h2>最近异常</h2>
        <p class="muted">
          仅记录故障元数据，最多显示 100 条，不包含用户会话和文件内容。
        </p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>位置 / 错误码</th>
            <th>关联标识</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td>{{ time(event.createdAt) }}</td>
            <td>
              <strong>{{ event.stage || event.kind }}</strong><small>{{ event.code }}</small>
            </td>
            <td>
              <code>{{ event.taskId || event.requestId || '—' }}</code><small v-if="event.providerRequestId">服务商 {{ event.providerRequestId }}</small>
            </td>
            <td>
              {{ event.httpStatus || '—'
              }}<small v-if="event.durationMs !== undefined">{{ event.durationMs }} ms</small>
            </td>
            <td>
              <button v-if="event.taskId" @click="inspect(event.taskId)">
                查看任务
              </button>
            </td>
          </tr>
          <tr v-if="!events.length">
            <td colspan="5" class="muted">
              {{ busy ? '正在读取…' : '暂无异常记录' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.metrics article {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: white;
}
.metrics span,
.metrics small {
  color: var(--muted);
  font-size: 12px;
}
.metrics strong {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.7px;
}
.metrics em {
  font-style: normal;
  font-size: 13px;
  color: var(--muted);
}
.task-states {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 12px 0 20px;
}
.task-states span {
  font-size: 12px;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: white;
  color: var(--muted);
}
.task-states b {
  margin-left: 12px;
  color: var(--ink);
}
.warnings {
  border-left: 3px solid #d9a03c;
  background: #fff8eb;
  padding: 3px 14px;
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.65;
}
.lookup {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 20px;
}
.lookup label {
  font-size: 13px;
  white-space: nowrap;
}
.lookup input {
  width: min(420px, 100%);
  min-width: 0;
}
.panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: white;
  overflow: hidden;
}
.section-heading {
  padding: 18px 20px 8px;
}
h2 {
  font-size: 15px;
  margin: 0;
}
td small {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: 11px;
}
td code {
  overflow-wrap: anywhere;
  font-size: 11px;
}
@media (max-width: 1100px) {
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .metrics {
    gap: 8px;
  }
  .metrics article {
    padding: 13px;
  }
  .metrics strong {
    font-size: 22px;
  }
  .lookup {
    flex-wrap: wrap;
  }
  .lookup input {
    flex: 1;
  }
  .lookup label {
    width: 100%;
  }
}
</style>
