<script setup lang="ts">
import type { OperationsModelCallDetail } from '@t-box/shared'
import {
  billingLabels,
  callLabels,
  duration,
  pretty,
  purposeLabels,
  time,
} from './operation-format'

defineProps<{ call: OperationsModelCallDetail }>()
</script>

<template>
  <div class="record-detail">
    <div class="record-summary">
      <span class="badge" :class="{ disabled: call.status !== 'succeeded' }">{{
        callLabels[call.status]
      }}</span><strong>{{ call.name }}</strong><span>{{ call.providerName }} · {{ call.remoteModel }}</span>
    </div>
    <dl class="record-meta">
      <dt>调用 ID</dt>
      <dd class="mono">{{ call.callId }}</dd>
      <dt>任务 ID</dt>
      <dd class="mono">{{ call.taskId || '无关联任务' }}</dd>
      <dt>用户</dt>
      <dd>
        {{ call.user.nickname }} · {{ call.user.username
        }}<small class="mono">{{ call.user.id }}</small>
      </dd>
      <dt>模型配置</dt>
      <dd>
        {{ call.id
        }}<small>{{ call.invocationMode }} · {{ call.method }}</small>
      </dd>
      <dt>调用阶段</dt>
      <dd>
        {{ purposeLabels[call.purpose] || call.purpose
        }}{{ call.purpose === 'title' ? ' · 用户免费' : '' }}
      </dd>
      <dt>重试次数</dt>
      <dd>
        {{ call.retryIndex
        }}<small>逻辑请求 {{ call.logicalId }}；0 表示首次请求</small>
      </dd>
      <dt>请求时间</dt>
      <dd>{{ time(call.createdAt) }}</dd>
      <dt>开始 / 结束</dt>
      <dd>{{ time(call.startedAt) }} / {{ time(call.finishedAt) }}</dd>
      <dt>用时 / 排队</dt>
      <dd>{{ duration(call.durationMs) }} / {{ duration(call.queueMs) }}</dd>
      <dt>计费状态</dt>
      <dd>
        {{
          call.billingStatus
            ? billingLabels[call.billingStatus]
            : '未产生计费记录'
        }}<small>记录费用 {{ call.cost == null ? '—' : `¥${call.cost}` }} · 实扣
          {{ call.charged == null ? '—' : `${call.charged} 额度` }}</small>
      </dd>
      <dt>上游原价 / 实际成本</dt>
      <dd>¥{{ call.originalCost ?? '—' }} / ¥{{ call.cost ?? '—' }}</dd>
      <dt>应扣 / 实扣额度</dt>
      <dd>
        {{ call.expectedQuota ?? '—' }} / {{ call.charged ?? '—'
        }}<small>{{
          call.billingMode === 'record_only'
            ? '免费或平台承担：记录但不扣额度'
            : '按授权额度核销'
        }}</small>
      </dd>
      <dt v-if="call.allocations?.length">资源包分摊</dt>
      <dd v-if="call.allocations?.length">
        <small
          v-for="a in call.allocations"
          :key="a.lotId"
        >{{ a.name }}：扣 {{ a.consumed }}，退 {{ a.returned }}，预占
          {{ a.reserved }}</small>
      </dd>
      <dt>Token 用量</dt>
      <dd>
        输入 {{ call.inputTokens ?? '未知' }} / 输出
        {{ call.outputTokens ?? '未知'
        }}<small>缓存输入 {{ call.cachedInputTokens ?? '未知' }} · 缓存写入
          {{ call.cacheWriteTokens ?? '未知' }} · 推理
          {{ call.reasoningTokens ?? '未知' }} · 图片
          {{ call.images ?? '—' }} 张</small>
      </dd>
      <dt>服务商请求</dt>
      <dd class="mono">{{ call.providerRequestId || '—' }}</dd>
      <dt>响应 ID</dt>
      <dd class="mono">{{ call.responseId || '—' }}</dd>
    </dl>
    <section v-if="call.userError" class="record-error">
      <h3>用户可见失败原因</h3>
      <p>{{ call.userError }}</p>
    </section>
    <details v-if="call.diagnostics" open>
      <summary>底层失败原因</summary>
      <pre>{{ pretty(call.diagnostics) }}</pre>
    </details>
    <details open>
      <summary>模型输入</summary>
      <pre>{{ pretty(call.input) }}</pre>
    </details>
    <details open>
      <summary>模型输出</summary>
      <pre>{{ pretty(call.output) }}</pre>
    </details>
    <details>
      <summary>本次计费单价快照</summary>
      <pre>{{ pretty(call.prices) }}</pre>
    </details>
    <p class="muted">
      敏感凭据和二进制内容会隐藏，超长输入输出会截断。请求结果与计费状态分别记录；“用量待核对”不代表零消耗。
    </p>
    <details v-if="call.tariff">
      <summary>用户额度费率快照</summary>
      <pre>{{ pretty(call.tariff) }}</pre>
    </details>
  </div>
</template>
