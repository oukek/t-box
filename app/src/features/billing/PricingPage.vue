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
  <section class="billing-detail-page pricing-page">
    <ApplicationHeader
      title="AI 费用说明"
      back-label="AI"
      @back="backFromApplication"
    ><template #actions><button
      class="wallet-refresh"
      aria-label="刷新费率"
      :disabled="loading"
      @click="load"
    ><AppIcon name="refresh" :size="18" /></button></template></ApplicationHeader>
    <div class="billing-page-heading"><p class="billing-eyebrow">每次使用，都有明细</p><h1>用多少，结算多少</h1><p>会话按实际用量计费，图片按张计费，统一从资源包额度中扣除。</p></div>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >{{ error }}<button class="billing-text-button" @click="load">重试</button></p>
    <div v-if="loading" class="wallet-empty">正在读取费率…</div>
    <template v-else-if="schedule">
      <p v-if="!schedule.enabled" class="recharge-unavailable">费率尚未开放，以下为待确认费率。</p>
      <div class="pricing-layout">
        <article class="billing-price-card"><header><span class="pricing-category-icon"><AppIcon name="chat" :size="21" /></span><div><h2>会话与看图</h2><p>每百万 token 消耗的额度</p></div></header>
          <dl class="pricing-token-rates"><div><dt>输入</dt><dd>{{ fee(schedule.inputPerMillion) }}</dd><span>发送内容与上下文</span></div><div><dt>缓存输入</dt><dd>{{ fee(schedule.cachedInputPerMillion) }}</dd><span>命中服务商缓存</span></div><div><dt>输出</dt><dd>{{ fee(schedule.outputPerMillion) }}</dd><span>回复与推理用量</span></div></dl>
          <p class="billing-card-note">token 是模型计算用量的单位，不等同于字数。输入可能包含历史上下文、图片及工具定义。</p>
        </article>
        <article class="billing-price-card"><header><span class="pricing-category-icon"><AppIcon name="image" :size="21" /></span><div><h2>图片生成与编辑</h2><p>每张图片消耗的额度</p></div></header>
          <table class="pricing-image-rates"><thead><tr><th>分辨率</th><th>生成</th><th>编辑</th></tr></thead><tbody><tr v-for="tier in ['1k', '2k', '4k'] as const" :key="tier"><th>{{ tier.toUpperCase() }}</th><td>{{ schedule.images[tier] }}</td><td>{{ schedule.edits[tier] }}</td></tr></tbody></table>
          <p class="billing-card-note">可用分辨率以当前服务能力为准，未达到请求分辨率不扣额度。</p>
        </article>
      </div>
      <section class="billing-settlement"><h2>一笔费用，怎样结算</h2><ol><li><span>1</span><div><strong>调用前预占</strong><p>暂时锁定本次任务需要的额度。</p></div></li><li><span>2</span><div><strong>按实际用量结算</strong><p>服务端收到用量后，立即记录费用。</p></div></li><li><span>3</span><div><strong>退回多余预占</strong><p>未使用的部分自动回到可用额度。</p></div></li></ol></section>
      <div class="billing-pricing-notes"><details open><summary>哪些操作不消耗 AI 额度？</summary><p>标题生成、记忆整理和自动上下文压缩由平台承担。文件上传、本地工具和预览不消耗 AI 额度。</p></details><details><summary>失败或中断的任务怎么结算？</summary><p>失败调用不扣额度；任务部分成功时，保留已成功调用的费用。免费用户记录用量与应扣额度，实扣为零。</p></details><details><summary>额度使用顺序与单次上限</summary><p>优先消耗最早到期的资源包，可跨包结算。每个任务最多使用 {{ schedule.taskLimit }} 额度、生成 {{ schedule.imageLimit }} 张图片，文字与图片合并计算。输出包含服务商报告的推理用量，不重复计费。</p></details></div>
      <p class="billing-rate-version">当前费率 v{{ schedule.version }} · 任务使用开始时固定的费率，后续调整不影响进行中的任务。</p>
    </template>
  </section>
</template>
