<script setup lang="ts">
import type { OperationsTaskDetail } from '@t-box/shared'
import {
  billingLabels,
  callLabels,
  duration,
  pretty,
  purposeLabels,
  taskLabels,
  time,
} from './operation-format'

defineProps<{ task: OperationsTaskDetail }>()
defineEmits<{ call: [id: string] }>()
</script>

<template>
  <div class="record-detail">
    <dl class="record-meta">
      <dt>任务 ID</dt>
      <dd class="mono">{{ task.id }}</dd>
      <dt>用户</dt>
      <dd>
        {{ task.user.nickname }} · {{ task.user.username
        }}<small class="mono">{{ task.user.id }}</small>
      </dd>
      <dt>会话 ID</dt>
      <dd class="mono">{{ task.conversationId }}</dd>
      <dt>请求 ID</dt>
      <dd class="mono">{{ task.requestId }}</dd>
      <dt>状态</dt>
      <dd>{{ taskLabels[task.status] || task.status }} · {{ task.agentId }}</dd>
      <dt>创建 / 更新</dt>
      <dd>{{ time(task.createdAt) }} / {{ time(task.updatedAt) }}</dd>
      <dt>重试 / 恢复</dt>
      <dd>
        模型重试 {{ task.retryCount }} 次 · 任务恢复
        {{ task.recoveryAttempts }} 次{{
          task.automaticRecovery ? ' · 待自动续办' : ''
        }}
      </dd>
    </dl>
    <p v-if="task.reason" class="record-error">{{ task.reason }}</p>
    <details v-if="task.error" open>
      <summary>用户任务失败原因</summary>
      <pre>{{ pretty(task.error) }}</pre>
    </details>
    <details open>
      <summary>用户输入</summary>
      <pre>{{ pretty(task.input) }}</pre>
    </details>
    <details open>
      <summary>任务输出</summary>
      <pre>{{ pretty(task.output) }}</pre>
    </details>
    <h3>逐次模型调用 · {{ task.modelCalls.length }}</h3>
    <div v-if="task.modelCalls.length" class="call-stack">
      <button
        v-for="(call, index) in task.modelCalls"
        :key="call.callId"
        class="call-record"
        @click="$emit('call', call.callId)"
      >
        <span class="call-order">{{ index + 1 }}</span><span><strong>{{ purposeLabels[call.purpose] || call.purpose }} ·
          {{ call.name }}</strong><small>{{ call.providerName }} · {{ callLabels[call.status] }} ·
          {{ duration(call.durationMs)
          }}{{
            call.retryIndex ? ` · 第 ${call.retryIndex} 次重试` : ''
          }}</small><small v-if="call.userError" class="failure-text">{{
          call.userError
        }}</small></span><span>{{ call.cost == null ? '—' : `¥${call.cost}`
        }}<small>{{
          call.billingStatus ? billingLabels[call.billingStatus] : '未计费'
        }}</small></span><span aria-hidden="true">›</span>
      </button>
    </div>
    <p v-else class="muted">
      暂无逐次调用记录。审计功能启用前的输入输出和底层错误无法追溯补录。
    </p>
    <details v-if="task.usage.length">
      <summary>计费流水 · {{ task.usage.length }}</summary>
      <ul class="legacy-usage">
        <li v-for="usage in task.usage" :key="usage.id">
          <strong>{{ purposeLabels[usage.purpose] || usage.purpose }} ·
            {{ billingLabels[usage.status] || usage.status }}</strong><span>记录 ¥{{ usage.cost }} · 实扣额度 {{ usage.charged }}</span><small>{{ usage.id }}</small>
        </li>
      </ul>
    </details>
    <details>
      <summary>工具操作 · {{ task.tools.length }}</summary>
      <ul class="legacy-usage">
        <li v-for="tool in task.tools" :key="tool.callId">
          <strong>{{ tool.name }} · {{ tool.status }}</strong><small>{{ tool.effect }} · {{ tool.callId }}</small>
        </li>
        <li v-if="!task.tools.length">暂无工具调用</li>
      </ul>
    </details>
  </div>
</template>
