<script setup lang="ts">
import type { WechatLoginConfiguration } from '@t-box/shared'
import { onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminInput from '../components/AdminInput.vue'
import { errorMessage, request, save } from '../core/api'

const form = reactive<WechatLoginConfiguration & { appSecret: string }>({ enabled: false, appId: '', appSecret: '', frontendUrl: 'https://tboxos.cn', hasAppSecret: false, revision: 0 })
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const config = await request<WechatLoginConfiguration>('/auth/wechat')
    Object.assign(form, config, { frontendUrl: config.frontendUrl || 'https://tboxos.cn', appSecret: '' })
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}
async function submit() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    Object.assign(form, await save<WechatLoginConfiguration>('/auth/wechat', form, 'PATCH'), { appSecret: '' })
    notice.value = '微信登录配置已保存。'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">WECHAT</p>
      <h1>微信登录</h1>
      <p>微信内授权登录，其他浏览器扫码后在手机上确认。首次授权取得微信资料，站内默认昵称为“方舟”，头像和昵称可独立修改。</p>
    </div>
    <AdminButton :disabled="loading || busy" @click="load">刷新</AdminButton>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >{{ error }}</p>
  <p v-if="notice" role="status">{{ notice }}</p>
  <section class="panel">
    <p v-if="loading" class="empty">正在读取配置…</p>
    <form
      v-else
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label>认证服务号 AppID<AdminInput
            v-model="form.appId"
            autocomplete="off"
            placeholder="wx…"
          /><small>请使用有网页授权权限的服务号，微信支付绑定同一 AppID。</small></label>
          <label>服务号 AppSecret<AdminInput
            v-model="form.appSecret"
            type="password"
            autocomplete="new-password"
            :placeholder="form.hasAppSecret ? '已加密保存，留空保留' : '公众号开发信息中的 AppSecret'"
          /></label>
          <label class="wide">前端网站根地址<AdminInput
            v-model="form.frontendUrl"
            type="url"
            placeholder="https://tboxos.cn"
          /><small>不带路径、查询参数或 #。网页授权回调为此地址加 /。</small></label>
          <label class="check wide"><AdminCheckbox v-model="form.enabled" />开放微信登录</label>
        </div>
      </fieldset>
      <p class="muted">公众号后台的“网页授权域名”填写 tboxos.cn。支付配置会复用此处同一 AppID 的 AppSecret；登录可以独立于支付开放。</p>
      <AdminButton
        class="primary"
        type="submit"
        :disabled="busy"
      >{{ busy ? '正在保存…' : '保存配置' }}</AdminButton>
    </form>
  </section>
</template>
