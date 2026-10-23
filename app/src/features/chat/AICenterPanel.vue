<script setup lang="ts">
import type { Wallet } from '@t-box/shared'
import { AppIcon, SidePanel } from '@t-box/ui-kit'
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  openMemory,
  openPricing,
  openResources,
  openWallet,
} from '../../core/navigation'
import { request } from '../../core/network'
import { identity } from '../../core/session'
import { displayMoney } from '../billing/format'
import { useQuotaRefresh } from '../billing/quota-events'
import NotificationPanel from './NotificationPanel.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], tasks: [] }>()
const wallet = ref<Wallet | null>(null)
const loading = ref(false)
const error = ref(false)
useQuotaRefresh(
  async () => {
    if (props.open && identity.user) {
      try {
        wallet.value = (await request<{ data: Wallet }>('/wallet')).data
      } catch {
        error.value = true
      }
    }
  },
  () => props.open,
)
const notificationsOpen = ref(false)
watch(
  () => [props.open, identity.user?.id],
  () => {
    notificationsOpen.value = false
  },
)
let controller: AbortController | undefined
watch(
  () => [props.open, identity.user?.id] as const,
  async ([open, id]) => {
    controller?.abort()
    wallet.value = null
    error.value = false
    loading.value = false
    if (!open || !id) {
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    loading.value = true
    try {
      const result = await request<{ data: Wallet }>('/wallet', { signal })
      if (!signal.aborted) {
        wallet.value = result.data
      }
    } catch {
      if (!signal.aborted) {
        error.value = true
      }
    } finally {
      if (!signal.aborted) {
        loading.value = false
      }
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
function openPage(action: () => void) {
  emit('close')
  action()
}
function openTasksFromNotification() {
  notificationsOpen.value = false
  emit('tasks')
}
</script>

<template>
  <SidePanel
    :open="open"
    title="AI 中心"
    @close="emit('close')"
  >
    <div class="ai-center">
      <button class="ai-center-link" @click="openPage(openMemory)">
        <span class="ai-center-icon"><AppIcon name="history" :size="18" /></span><span>记忆<small>管理已记住的信息与待确认建议</small></span><AppIcon name="right" :size="16" />
      </button>
      <button
        class="ai-center-balance"
        aria-label="查看我的额度"
        @click="openPage(openWallet)"
      >
        <span><AppIcon name="wallet" :size="18" />我的额度<AppIcon
          name="right"
          :size="16"
        /></span>
        <strong>{{
          loading
            ? '…'
            : wallet
              ? `${displayMoney(wallet.available)} 额度`
              : '—'
        }}</strong>
        <small>{{
          error
            ? '暂时无法读取，点击查看或重试'
            : wallet?.mode === 'record_only'
              ? '免费用户 · 记录用量，不扣额度'
              : '查看资源包、到期时间与使用记录'
        }}</small>
      </button>
      <h3>使用与费用</h3>
      <button class="ai-center-link" @click="openPage(openPricing)">
        <span class="ai-center-icon"><AppIcon name="info" :size="20" /></span>
        <span>AI 费用说明<small>会话与图片的当前价格</small></span>
        <AppIcon name="right" :size="16" />
      </button>
      <h3>资料与任务</h3>
      <button class="ai-center-link" @click="notificationsOpen = true">
        <span class="ai-center-icon"><AppIcon name="info" :size="20" /></span>
        <span>通知<small>已完成与待处理的任务</small></span>
        <AppIcon name="right" :size="16" />
      </button>
      <button class="ai-center-link" @click="openPage(openResources)">
        <span class="ai-center-icon"><AppIcon name="image" :size="20" /></span>
        <span>我的资源<small>上传的文件与生成的作品</small></span>
        <AppIcon name="right" :size="16" />
      </button>
      <button class="ai-center-link" @click="emit('tasks')">
        <span class="ai-center-icon"><AppIcon name="task" :size="20" /></span>
        <span>任务记录<small>执行进度与处理结果</small></span>
        <AppIcon name="right" :size="16" />
      </button>
    </div>
  </SidePanel>
  <NotificationPanel
    :open="notificationsOpen"
    @close="notificationsOpen = false"
    @tasks="openTasksFromNotification"
  />
</template>

<style scoped>
.ai-center {
  padding: 8px 4px;
}
.ai-center-balance {
  width: 100%;
  border: 1px solid #dce9e4;
  border-radius: 13px;
  padding: 18px;
  text-align: left;
  background: #edf5f1;
  color: #285d53;
}
.ai-center-balance > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ai-center-balance > span > svg:last-child {
  margin-left: auto;
}
.ai-center-balance strong {
  display: block;
  margin: 18px 0 10px;
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ai-center-balance small {
  color: #648579;
  font-size: 11px;
  line-height: 1.6;
}
.ai-center h3 {
  margin: 26px 10px 8px;
  font-size: 11px;
  color: #82928f;
  font-weight: 500;
}
.ai-center-link {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 15px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font-size: 14px;
}
.ai-center-link:hover {
  background: #f0f5f3;
}
.ai-center-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: #eff4f2;
  color: #628b7f;
  flex-shrink: 0;
}
.ai-center-link > span:nth-child(2) {
  flex: 1;
}
.ai-center-link small {
  display: block;
  margin-top: 6px;
  color: #8b9a98;
  font-size: 11px;
}
.ai-center-link > svg {
  color: #9caaa6;
  flex-shrink: 0;
}
</style>
