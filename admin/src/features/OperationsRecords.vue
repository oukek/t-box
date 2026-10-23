<script setup lang="ts">
import type {
  AIModelConfig,
  AIProviderConfig,
  OperationsModelCall,
  OperationsModelCallDetail,
  OperationsPage,
  OperationsTaskDetail,
  OperationsTaskRow,
} from '@t-box/shared'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request } from '../core/api'
import ModelCallDetail from './ModelCallDetail.vue'
import {
  callLabels,
  duration,
  purposeLabels,
  taskLabels,
  time,
} from './operation-format'
import TaskRecordDetail from './TaskRecordDetail.vue'
import './operations-records.css'

const tab = ref<'tasks' | 'calls'>('tasks')
const search = ref('')
const status = ref('')
const modelId = ref('')
const providerId = ref('')
const models = ref<AIModelConfig[]>([])
const providers = ref<AIProviderConfig[]>([])
const tasks = ref<OperationsTaskRow[]>([])
const calls = ref<OperationsModelCall[]>([])
const page = ref(1)
const total = ref(0)
const busy = ref(false)
const error = ref('')
const detailError = ref('')
const detailBusy = ref(false)
const open = ref(false)
const task = ref<OperationsTaskDetail | null>(null)
const call = ref<OperationsModelCallDetail | null>(null)
let filterQuery = ''
let listController: AbortController | undefined
let detailController: AbortController | undefined
let timer: ReturnType<typeof setInterval> | undefined
let alive = true
const statusOptions = computed(() => [
  { value: '', label: '全部状态' },
  ...Object.entries(tab.value === 'tasks' ? taskLabels : callLabels).map(
    ([value, label]) => ({ value, label }),
  ),
])
const modelOptions = computed(() => [
  { value: '', label: '全部模型' },
  ...models.value.map((m) => ({
    value: m.id,
    label: m.name,
    description: `${m.providerName} · ${m.modelId}`,
  })),
])
const providerOptions = computed(() => [
  { value: '', label: '全部服务商' },
  ...providers.value.map((p) => ({ value: p.id, label: p.name })),
])
const pages = computed(() => Math.max(1, Math.ceil(total.value / 20)))
async function load(quiet = false) {
  if (quiet && busy.value) {
    return
  }
  listController?.abort()
  const current = new AbortController()
  listController = current
  busy.value = true
  try {
    const result = await request<
      OperationsPage<OperationsTaskRow> | OperationsPage<OperationsModelCall>
    >(`/operations/${tab.value}?page=${page.value}&${filterQuery}`, {
      signal: current.signal,
    })
    if (current.signal.aborted || !alive) {
      return
    }
    if (tab.value === 'tasks') {
      tasks.value = (result as OperationsPage<OperationsTaskRow>).items
    } else {
      calls.value = (result as OperationsPage<OperationsModelCall>).items
    }
    total.value = result.total
    error.value = ''
  } catch (e) {
    if (!current.signal.aborted && alive) {
      error.value = errorMessage(e)
    }
  } finally {
    if (!current.signal.aborted && alive) {
      busy.value = false
    }
  }
}
function apply() {
  const query = new URLSearchParams()
  if (search.value.trim()) {
    query.set('search', search.value.trim())
  }
  if (status.value) {
    query.set('status', status.value)
  }
  if (modelId.value) {
    query.set('modelId', modelId.value)
  }
  if (providerId.value) {
    query.set('providerId', providerId.value)
  }
  filterQuery = query.toString()
  page.value = 1
  void load()
}
function switchTab(value: 'tasks' | 'calls') {
  if (value === tab.value) {
    return
  }
  tab.value = value
  status.value = ''
  tasks.value = []
  calls.value = []
  apply()
}
function movePage(offset: number) {
  page.value += offset
  void load()
}
function close() {
  detailController?.abort()
  open.value = false
  detailBusy.value = false
}
async function inspectTask(id: string) {
  detailController?.abort()
  const current = new AbortController()
  detailController = current
  task.value = null
  call.value = null
  open.value = true
  detailBusy.value = true
  detailError.value = ''
  try {
    const value = await request<OperationsTaskDetail>(
      `/operations/tasks/${encodeURIComponent(id)}`,
      { signal: current.signal },
    )
    if (!current.signal.aborted && alive) {
      task.value = value
    }
  } catch (e) {
    if (!current.signal.aborted && alive) {
      detailError.value = errorMessage(e)
    }
  } finally {
    if (!current.signal.aborted && alive) {
      detailBusy.value = false
    }
  }
}
async function inspectCall(id: string) {
  detailController?.abort()
  const current = new AbortController()
  detailController = current
  call.value = null
  open.value = true
  detailBusy.value = true
  detailError.value = ''
  try {
    const value = await request<OperationsModelCallDetail>(
      `/operations/calls/${encodeURIComponent(id)}`,
      { signal: current.signal },
    )
    if (!current.signal.aborted && alive) {
      call.value = value
    }
  } catch (e) {
    if (!current.signal.aborted && alive) {
      detailError.value = errorMessage(e)
    }
  } finally {
    if (!current.signal.aborted && alive) {
      detailBusy.value = false
    }
  }
}
function openCall(id: string) {
  task.value = null
  void inspectCall(id)
}
defineExpose({ inspectTask, refresh: load })
onMounted(async () => {
  void load()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void load(true)
    }
  }, 5000)
  const result = await Promise.allSettled([
    request<AIModelConfig[]>('/models'),
    request<AIProviderConfig[]>('/providers'),
  ])
  if (!alive) {
    return
  }
  if (result[0].status === 'fulfilled') {
    models.value = result[0].value
  }
  if (result[1].status === 'fulfilled') {
    providers.value = result[1].value
  }
})
onBeforeUnmount(() => {
  alive = false
  clearInterval(timer)
  listController?.abort()
  detailController?.abort()
})
</script>

<template>
  <section class="records-panel">
    <div class="records-toolbar">
      <div
        class="records-tabs"
        role="tablist"
        aria-label="执行记录类型"
      >
        <AdminButton
          role="tab"
          :aria-selected="tab === 'tasks'"
          @click="switchTab('tasks')"
        >
          任务列表</AdminButton><AdminButton
          role="tab"
          :aria-selected="tab === 'calls'"
          @click="switchTab('calls')"
        >
          逐次模型调用
        </AdminButton>
      </div>
      <span>每 5 秒自动刷新 · 详情含输入输出</span><AdminButton :disabled="busy" @click="load()">
        {{ busy ? '刷新中…' : '刷新列表' }}
      </AdminButton>
    </div>
    <form class="records-filters" @submit.prevent="apply">
      <label>搜索<AdminInput
        v-model="search"
        maxlength="100"
        placeholder="任务 / 调用 ID、用户账号、昵称"
      /></label>
      <label>状态<AdminSelect
        v-model="status"
        label="执行状态"
        :options="statusOptions"
      /></label>
      <label>服务商<AdminSelect
        v-model="providerId"
        label="服务商筛选"
        :options="providerOptions"
        searchable
      /></label>
      <label>模型<AdminSelect
        v-model="modelId"
        label="模型筛选"
        :options="modelOptions"
        searchable
      /></label>
      <AdminButton type="submit" class="primary">查询</AdminButton>
    </form>
    <p
      v-if="error"
      class="alert"
      role="alert"
    >{{ error }}</p>
    <div class="table-wrap">
      <table v-if="tab === 'tasks'" class="records-table">
        <colgroup>
          <col class="record-col-time">
          <col class="record-col-user">
          <col class="record-col-model">
          <col class="record-col-state">
          <col class="record-col-cost">
          <col class="record-col-attempts">
          <col>
          <col class="record-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>任务 / 创建时间</th>
            <th>用户</th>
            <th>模型 / 服务商</th>
            <th>状态</th>
            <th>消耗 / 实扣</th>
            <th>调用 / 重试</th>
            <th>失败原因</th>
            <th class="record-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tasks" :key="row.id">
            <td>
              <time>{{ time(row.createdAt) }}</time><code class="record-id" :title="row.id">{{ row.id }}</code>
            </td>
            <td>
              <strong>{{ row.user.nickname || row.user.username }}</strong><small>{{ row.user.username }}</small>
            </td>
            <td class="record-models">
              <div
                v-for="(model, index) in row.models"
                :key="`${model.id}-${index}`"
              >
                <strong>{{ model.name }}</strong><small>{{ model.providerName }}</small>
              </div>
              <small v-if="!row.models.length">尚未分配 / 无历史快照</small>
            </td>
            <td class="record-state">
              <span
                class="badge"
                :class="{ disabled: row.status !== 'completed' }"
              >{{ taskLabels[row.status] || row.status }}</span>
            </td>
            <td>
              ¥{{ row.cost }}<small>实扣额度 {{ row.charged }}</small><small>{{ row.inputTokens }} 入 / {{ row.outputTokens }} 出</small><small
                v-if="row.unresolved"
                class="failure-text"
              >{{ row.unresolved }} 次用量待核对</small>
            </td>
            <td>
              {{ row.calls }} 次调用<small>{{ row.retryCount }} 次重试 ·
                {{ row.recoveryAttempts }} 次恢复</small>
            </td>
            <td class="record-problem">
              <small
                :title="row.reason || undefined"
                :class="{ 'failure-text': row.reason }"
              >{{
                row.reason
                  || (row.failedCalls
                    ? `${row.failedCalls} 次调用异常，详见执行记录`
                    : '—')
              }}</small>
            </td>
            <td class="record-actions">
              <AdminButton @click="inspectTask(row.id)">详情</AdminButton>
            </td>
          </tr>
          <tr v-if="!tasks.length">
            <td colspan="8" class="muted">
              {{ busy ? '正在读取…' : '暂无符合条件的任务' }}
            </td>
          </tr>
        </tbody>
      </table>
      <table v-else class="records-table">
        <colgroup>
          <col class="record-col-time">
          <col class="record-col-user">
          <col class="record-col-model">
          <col class="record-col-state">
          <col class="record-col-cost">
          <col class="record-col-attempts">
          <col>
          <col class="record-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>请求时间 / 调用 ID</th>
            <th>用户</th>
            <th>模型 / 服务商</th>
            <th>阶段 / 状态</th>
            <th>消耗 / 实扣</th>
            <th>用时 / 重试</th>
            <th>用户失败原因</th>
            <th class="record-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in calls" :key="row.callId">
            <td>
              {{ time(row.createdAt)
              }}<code class="record-id" :title="row.callId">{{
                row.callId
              }}</code>
            </td>
            <td>
              <strong>{{ row.user.nickname || row.user.username }}</strong><small>{{ row.user.username }}</small>
            </td>
            <td class="record-models">
              <strong>{{ row.name }}</strong><small>{{ row.providerName }} · {{ row.remoteModel }}</small>
            </td>
            <td class="record-state">
              {{ purposeLabels[row.purpose] || row.purpose
              }}<small>{{ callLabels[row.status] }}</small>
            </td>
            <td>
              {{ row.cost == null ? '—' : `¥${row.cost}`
              }}<small>实扣
                {{ row.charged == null ? '—' : `${row.charged} 额度` }}</small><small>{{ row.inputTokens ?? '未知' }} 入 /
                {{ row.outputTokens ?? '未知' }} 出</small><small
                v-if="row.billingStatus === 'review'"
                class="failure-text"
              >用量待核对</small>
            </td>
            <td>
              {{ duration(row.durationMs)
              }}<small>{{ row.retryIndex }} 次重试</small>
            </td>
            <td class="record-problem">
              <small
                :title="row.userError || undefined"
                :class="{ 'failure-text': row.userError }"
              >{{ row.userError || '—' }}</small>
            </td>
            <td class="record-actions">
              <AdminButton @click="openCall(row.callId)">详情</AdminButton>
            </td>
          </tr>
          <tr v-if="!calls.length">
            <td colspan="8" class="muted">
              {{ busy ? '正在读取…' : '暂无调用记录；历史调用不补录输入输出' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer class="records-pagination">
      <span>共 {{ total }} 条 · 每页 20 条</span>
      <div>
        <AdminButton :disabled="page <= 1 || busy" @click="movePage(-1)">
          上一页</AdminButton><span>{{ page }} / {{ pages }}</span><AdminButton :disabled="page >= pages || busy" @click="movePage(1)">
          下一页
        </AdminButton>
      </div>
    </footer>
  </section>
  <AdminDialog
    :open="open"
    :title="call ? '模型调用详情' : '任务执行记录'"
    description="查看每一步的模型、费用、输入输出与失败原因。"
    @close="close"
  >
    <p v-if="detailBusy" class="muted">正在读取执行记录…</p>
    <p
      v-if="detailError"
      class="alert"
      role="alert"
    >{{ detailError }}</p>
    <template v-if="!detailBusy">
      <AdminButton
        v-if="call && task"
        class="detail-back"
        @click="call = null"
      >
        ‹ 返回任务
      </AdminButton>
      <ModelCallDetail v-if="call" :call="call" />
      <TaskRecordDetail
        v-else-if="task"
        :task="task"
        @call="inspectCall"
      />
    </template>
    <template #footer><AdminButton
      v-if="task && !call"
      :disabled="detailBusy"
      @click="inspectTask(task.id)"
    >
      刷新任务</AdminButton><AdminButton @click="close">关闭</AdminButton></template>
  </AdminDialog>
</template>
