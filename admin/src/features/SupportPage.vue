<script setup lang="ts">
import type { AdminCustomerSupportConfiguration } from '@t-box/shared'
import { onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import { errorMessage, request, save } from '../core/api'

const config = ref<AdminCustomerSupportConfiguration | null>(null)
const form = reactive({ enabled: false, qrCodeUrl: '' })
const loading = ref(true)
const busy = ref(false)
const open = ref(false)
const error = ref('')
const formError = ref('')
const previewFailed = ref(false)
async function load() {
  loading.value = true
  error.value = ''
  previewFailed.value = false
  try {
    config.value = await request<AdminCustomerSupportConfiguration>('/support')
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}
function edit() {
  if (!config.value) {
    return
  }
  form.enabled = config.value.enabled
  form.qrCodeUrl = config.value.qrCodeUrl
  formError.value = ''
  open.value = true
}
async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  formError.value = ''
  try {
    config.value = await save<AdminCustomerSupportConfiguration>(
      '/support',
      form,
      'PATCH',
    )
    previewFailed.value = false
    open.value = false
  } catch (cause) {
    formError.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">CUSTOMER SUPPORT</p>
      <h1>客服配置</h1>
      <p>管理 iOS 首页的微信客服入口。</p>
    </div>
    <div class="actions">
      <AdminButton
        :disabled="loading || !config"
        class="primary"
        @click="edit"
      > 编辑配置</AdminButton><AdminButton :disabled="loading" @click="load">刷新</AdminButton>
    </div>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <section class="panel">
    <div class="panel-heading">
      <h2>微信客服</h2>
      <span
        v-if="config"
        class="badge"
        :class="{ disabled: !config.enabled }"
      >{{ config.enabled ? "已开放" : "未开放" }}</span>
    </div>
    <div v-if="loading" class="empty">正在读取客服配置…</div>
    <div v-else-if="config" class="support-settings-content">
      <div class="support-preview">
        <img
          v-if="config.qrCodeUrl && !previewFailed"
          :src="config.qrCodeUrl"
          alt="客服二维码预览"
          width="200"
          height="200"
          referrerpolicy="no-referrer"
          @error="previewFailed = true"
        >
        <p v-else class="muted">
          {{
            previewFailed ? "二维码图片无法加载，请检查地址" : "尚未配置二维码"
          }}
        </p>
      </div>
      <div>
        <h3>联系客服</h3>
        <p class="muted">
          开启后，仅在 iOS 原生应用首页显示。Android 和网页不显示此入口。
        </p>
        <p class="muted">
          二维码仅作为客服联系方式，不会改变余额、扣费模式或支付通道。
        </p>
        <p v-if="config.updatedAt" class="muted">
          更新于 {{ new Date(config.updatedAt).toLocaleString() }}
        </p>
      </div>
    </div>
  </section>
  <AdminDialog
    :open="open"
    title="编辑客服配置"
    description="提供可直接访问的 HTTPS 二维码图片地址。"
    :busy="busy"
    @close="open = false"
  >
    <form id="support-settings-form" @submit.prevent="submit">
      <fieldset :disabled="busy">
        <p
          v-if="formError"
          class="alert"
          role="alert"
        >
          {{ formError }}
        </p>
        <label>二维码图片地址<AdminInput
          v-model="form.qrCodeUrl"
          type="url"
          placeholder="https://你的域名/客服二维码.png"
          maxlength="2048"
          :required="form.enabled"
        /></label>
        <label class="support-enabled"><AdminCheckbox v-model="form.enabled" />开放 iOS
          客服入口</label>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="open = false">取消</AdminButton><AdminButton
        type="submit"
        form="support-settings-form"
        class="primary"
        :disabled="busy"
      >
        {{ busy ? "正在保存…" : "保存配置" }}
      </AdminButton>
    </template>
  </AdminDialog>
</template>

<style scoped>
.support-settings-content {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 28px;
}
.support-preview {
  display: grid;
  place-items: center;
  width: 224px;
  min-height: 224px;
  padding: 12px;
  flex-shrink: 0;
  border: 1px solid #e5e9e7;
  border-radius: 12px;
  background: #fff;
  text-align: center;
}
.support-preview img {
  width: 200px;
  height: 200px;
  object-fit: contain;
}
.support-settings-content h3 {
  font-size: 16px;
  margin: 0 0 12px;
}
.support-settings-content p {
  line-height: 1.8;
  max-width: 480px;
}
.support-enabled {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 700px) {
  .support-settings-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 18px;
    padding: 20px;
  }
}
</style>
