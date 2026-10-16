<script setup lang="ts">
import type { AiFeeSchedule } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  backFromApplication,
  navigation,
  tabLabel,
} from '../../core/navigation'
import { request } from '../../core/network'
import { displayMoney as fee } from './format'
import './recharge.css'

const schedule = ref<AiFeeSchedule | null>(null)
const loading = ref(true)
const error = ref('')
const rate = (max: string, min?: string) => min && min !== max ? `${fee(min)}–${fee(max)}` : fee(max)
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  error.value = ''
  try {
    const result = await request<{ data: AiFeeSchedule }>('/wallet/pricing', {
      signal,
    })
    schedule.value = result.data
  } catch (cause) {
    if (!signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '读取价格失败'
    }
  } finally {
    if (!signal.aborted) {
      loading.value = false
    }
  }
}
onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="billing-detail-page">
    <ApplicationHeader
      title="AI 费用说明"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    >
      <template #actions>
        <button
          class="wallet-refresh"
          aria-label="刷新费用说明"
          :disabled="loading"
          @click="load"
        >
          <AppIcon name="refresh" :size="19" />
        </button>
      </template>
    </ApplicationHeader>
    <p class="billing-page-intro">
      按实际使用结算，每笔费用都可在余额记录中查看。
    </p>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >
      {{ error }}
      <button class="billing-text-button" @click="load">重新加载</button>
    </p>
    <div v-if="loading" class="wallet-empty">正在读取当前价格…</div>
    <template v-else-if="schedule">
      <article class="billing-price-card">
        <h2>
          <AppIcon name="chat" :size="20" />AI 会话<span>按 token 计费</span>
        </h2>
        <dl v-if="schedule.conversation">
          <div>
            <dt>输入</dt>
            <dd>
              ¥{{ rate(schedule.conversation.inputPrice, schedule.conversation.minInputPrice)
              }}<small>
                / {{ schedule.tokenUnit.toLocaleString() }} token</small>
            </dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>
              ¥{{ rate(schedule.conversation.outputPrice, schedule.conversation.minOutputPrice)
              }}<small>
                / {{ schedule.tokenUnit.toLocaleString() }} token</small>
            </dd>
          </div>
        </dl>
        <p v-else class="billing-card-note">AI 会话尚未开放，暂未提供价格。</p>
      </article>
      <article class="billing-price-card">
        <h2>
          <AppIcon name="image" :size="20" />图片生成与编辑<span>按成功图片计费</span>
        </h2>
        <dl v-if="schedule.image">
          <div>
            <dt>每张图片</dt>
            <dd>¥{{ rate(schedule.image.imagePrice, schedule.image.minImagePrice) }}<small> / 张</small></dd>
          </div>
        </dl>
        <p v-else class="billing-card-note">图片功能尚未开放，暂未提供价格。</p>
      </article>
      <div class="billing-explanation">
        <h2>费用怎么算</h2>
        <p>
          会话费用 =（输入 token × 输入单价 + 输出 token × 输出单价）÷
          {{ schedule.tokenUnit.toLocaleString() }}。token
          是模型处理文本或图片的用量单位，不等同于字数。
        </p>
        <p>
          多轮对话包含必要的历史上下文；工具调用和上下文整理产生的模型请求也会按用量记录。图片工具的费用另按成功生成或编辑的张数计算。
        </p>
        <p v-if="schedule.titleFree">
          会话标题生成免费。开启“仅记录费用”的账号会记录费用，不扣余额。
        </p>
        <p>这里显示当前价格；多种单价时显示价格范围，每次请求按实际调度服务的单价快照结算。</p>
      </div>
    </template>
  </section>
</template>
