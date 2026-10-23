<script setup lang="ts">
import type { WechatPaymentConfiguration } from '@t-box/shared'
import { reactive, ref, watch } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminTextarea from '../components/AdminTextarea.vue'
import { errorMessage, request, save } from '../core/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const form = reactive<
  WechatPaymentConfiguration & {
    privateKey: string
    apiV3Key: string
    appSecret: string
  }
>({
  enabled: false,
  appId: '',
  mobileAppId: '',
  app: false,
  merchantId: '',
  merchantSerial: '',
  platformSerial: '',
  platformPublicKey: '',
  apiBaseUrl: '',
  frontendUrl: '',
  description: 'T方舟 服务余额充值',
  native: true,
  h5: false,
  jsapi: false,
  privateKey: '',
  apiV3Key: '',
  appSecret: '',
})
watch(
  () => props.open,
  async (open) => {
    form.privateKey = ''
    form.apiV3Key = ''
    form.appSecret = ''
    if (!open) {
      return
    }
    loading.value = true
    error.value = ''
    try {
      Object.assign(
        form,
        await request<WechatPaymentConfiguration>('/payments/wechat'),
      )
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  },
)
async function submit() {
  busy.value = true
  error.value = ''
  try {
    await save('/payments/wechat', form, 'PATCH')
    form.privateKey = ''
    form.apiV3Key = ''
    form.appSecret = ''
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AdminDialog
    :open="open"
    title="微信支付配置"
    description="普通商户 · API v3。密钥加密保存，留空保留原值。"
    :busy="busy"
    @close="emit('close')"
  >
    <p
      v-if="error"
      class="alert"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-if="loading" class="empty">正在读取配置…</p>
    <form
      v-else
      id="wechat-config"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label>服务号 AppID<AdminInput
            v-model="form.appId"
            autocomplete="off"
            placeholder="wx…"
          /></label>
          <label>移动应用 AppID<AdminInput
            v-model="form.mobileAppId"
            autocomplete="off"
            placeholder="wx…"
          /><small>微信开放平台移动应用，与服务号独立</small></label>
          <label>商户号<AdminInput
            v-model="form.merchantId"
            inputmode="numeric"
            autocomplete="off"
          /></label>
          <label>商户 API 证书序列号<AdminInput
            v-model="form.merchantSerial"
            autocomplete="off"
          /></label>
          <label>微信支付公钥 ID / 平台证书序列号<AdminInput
            v-model="form.platformSerial"
            placeholder="PUB_KEY_ID_…"
            autocomplete="off"
          /></label>
          <label class="wide">微信支付公钥 / 平台证书 PEM<AdminTextarea
            v-model="form.platformPublicKey"
            monospace
            rows="4"
            spellcheck="false"
            placeholder="-----BEGIN PUBLIC KEY-----"
          />
          </label>
          <label class="wide">商户 API 私钥 PEM<AdminTextarea
            v-model="form.privateKey"
            monospace
            rows="4"
            spellcheck="false"
            autocomplete="off"
            :placeholder="
              form.hasPrivateKey
                ? '已配置，留空保留'
                : '-----BEGIN PRIVATE KEY-----'
            "
          />
          </label>
          <label>API v3 密钥<AdminInput
            v-model="form.apiV3Key"
            type="password"
            autocomplete="new-password"
            :placeholder="
              form.hasApiV3Key ? '已配置，留空保留' : '32 字节密钥'
            "
          /></label>
          <label>服务号 AppSecret<AdminInput
            v-model="form.appSecret"
            type="password"
            autocomplete="new-password"
            :placeholder="
              form.hasAppSecret ? '已配置，留空保留' : '微信内支付需要'
            "
          /></label>
          <label>API 公网地址<AdminInput
            v-model="form.apiBaseUrl"
            type="url"
            placeholder="https://api.example.com"
          /><small>不含 /api/v1；用于通知和授权回调</small></label>
          <label>支付网页地址<AdminInput
            v-model="form.frontendUrl"
            type="url"
            placeholder="https://app.example.com"
          /><small>前端网站根地址，不带 # 路由</small></label>
          <label class="wide">微信账单商品描述<AdminInput
            v-model="form.description"
            maxlength="127"
          /></label>
          <label class="check wide"><AdminCheckbox v-model="form.native" />PC 扫码 · Native
            支付</label>
          <label class="check wide"><AdminCheckbox v-model="form.h5" />微信外移动浏览器 · H5
            支付<small>需单独开通 H5 并配置支付域名</small></label>
          <label class="check wide"><AdminCheckbox v-model="form.jsapi" />微信内网页 · JSAPI
            支付<small>需绑定服务号，配置授权域名和支付授权目录</small></label>
          <label class="check wide"><AdminCheckbox v-model="form.app" />iOS / Android 原生 APP
            支付<small>需开通 APP 支付并绑定移动 AppID；壳内 AppID 必须一致。iOS
              Universal Link 和 Android 签名需在开放平台配置。</small></label>
          <label class="check wide"><AdminCheckbox
            v-model="form.enabled"
          />开放新充值订单</label>
          <p class="wide muted">
            停用后继续接收旧订单通知。每笔订单绑定创建时的商户配置；修改密钥不覆盖旧订单。
          </p>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="emit('close')">取消</AdminButton><AdminButton
        class="primary"
        type="submit"
        form="wechat-config"
        :disabled="busy || loading"
      >
        {{ busy ? "正在保存…" : "保存配置" }}
      </AdminButton>
    </template>
  </AdminDialog>
</template>
