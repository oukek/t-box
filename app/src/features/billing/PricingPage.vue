<script setup lang="ts">
import type { QuotaTariff } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { backFromApplication } from '../../core/navigation'
import { request } from '../../core/network'
import { displayMoney as fee } from './format'
import './recharge.css'

const schedule = ref<QuotaTariff | null>(null)
const loading = ref(true)
const error = ref('')
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    schedule.value = (
      await request<{ data: QuotaTariff }>('/wallet/pricing', {
        signal: controller.signal,
      })
    ).data
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '读取费率失败'
    }
  } finally {
    if (!controller.signal.aborted) {
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
      back-label="AI"
      @back="backFromApplication"
    ><template #actions><button
      class="wallet-refresh"
      aria-label="刷新费率"
      :disabled="loading"
      @click="load"
    >
      <AppIcon name="refresh" :size="19" /></button></template></ApplicationHeader>
    <p class="billing-page-intro">按实际用量实时结算，每笔额度变动都有记录。</p>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >
      {{ error }}<button class="billing-text-button" @click="load">重试</button>
    </p>
    <div v-if="loading" class="wallet-empty">正在读取费率…</div>
    <template v-else-if="schedule">
      <p v-if="!schedule.enabled" class="recharge-unavailable">
        费率尚未发布，AI 计费服务暂未开放。以下为待确认费率。
      </p>
      <article class="billing-price-card">
        <h2>
          <AppIcon name="chat" :size="20" />会话与看图<span>额度 / 百万 token</span>
        </h2>
        <dl>
          <div>
            <dt>输入</dt>
            <dd>{{ fee(schedule.inputPerMillion) }}</dd>
          </div>
          <div>
            <dt>缓存输入</dt>
            <dd>{{ fee(schedule.cachedInputPerMillion) }}</dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>{{ fee(schedule.outputPerMillion) }}</dd>
          </div>
        </dl>
      </article>
      <article class="billing-price-card">
        <h2>
          <AppIcon name="image" :size="20" />图片生成与编辑<span>额度 / 张</span>
        </h2>
        <dl>
          <div v-for="tier in ['1k', '2k', '4k'] as const" :key="tier">
            <dt>{{ tier.toUpperCase() }}</dt>
            <dd>
              生成 {{ schedule.images[tier] }} / 编辑 {{ schedule.edits[tier] }}
            </dd>
          </div>
        </dl>
        <p class="billing-card-note">
          可用分辨率以当前图片服务能力为准，未达到请求分辨率不扣额度。
        </p>
      </article>
      <div class="billing-explanation">
        <h2>如何结算</h2>
        <p>
          调用前预占额度，收到实际用量后立即结算并退回多余预占。每个任务最多使用
          {{ schedule.taskLimit }} 额度、生成
          {{ schedule.imageLimit }} 张图片，文字与图片合并计算。
        </p>
        <p>
          输入包含必要的历史上下文、图片和工具定义；已命中的缓存输入使用缓存费率。输出包含服务商报告的推理用量，不重复计费。
        </p>
        <p>
          标题生成、记忆整理和自动上下文压缩由平台承担；文件上传、本地工具和预览不消耗
          AI 额度。
        </p>
        <p>
          免费用户记录用量与应扣额度，实扣为零。失败调用不扣额度；任务部分成功时，保留已成功调用的费用。
        </p>
        <p>
          优先消耗最早到期的资源包，可跨包结算。当前费率版本 v{{
            schedule.version
          }}；任务使用开始时固定的费率。
        </p>
      </div>
    </template>
  </section>
</template>
