<script setup lang="ts">
import type { WechatLoginConfiguration } from '@t-box/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminInput from '../components/AdminInput.vue'
import { errorMessage, request, save } from '../core/api'
import './wechat-management.css'

const form = reactive<WechatLoginConfiguration & { appSecret: string }>({ enabled: false, appId: '', appSecret: '', frontendUrl: 'https://tboxos.cn', hasAppSecret: false, revision: 0 })
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const configuration = ref<WechatLoginConfiguration | null>(null)
const domain = computed(() => {
  try {
    return new URL(form.frontendUrl).hostname || 'tboxos.cn'
  } catch {
    return 'tboxos.cn'
  }
})
async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const config = await request<WechatLoginConfiguration>('/auth/wechat')
    configuration.value = config
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
    const saved = await save<WechatLoginConfiguration>('/auth/wechat', form, 'PATCH')
    configuration.value = saved
    Object.assign(form, saved, { appSecret: '' })
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
  <div class="wechat-management">
    <header class="page-heading">
      <div><p class="eyebrow">账号与身份</p><h1>微信登录</h1><p>用一个公众号，连接微信内授权与浏览器扫码登录。</p></div>
      <AdminButton :disabled="loading || busy" @click="load">刷新配置</AdminButton>
    </header>
    <p
      v-if="error"
      class="alert"
      role="alert"
    >{{ error }}</p>
    <p
      v-if="notice"
      class="wechat-save-notice"
      role="status"
    ><AdminIcon name="check" :size="16" />{{ notice }}</p>
    <div class="wechat-configuration-layout">
      <section class="panel wechat-account-panel">
        <div class="panel-heading"><div class="wechat-section-title"><span class="wechat-section-icon"><AdminIcon name="users" :size="20" /></span><div><h2>公众号连接</h2><p>已认证、具有网页授权权限的服务号</p></div></div><span
          v-if="configuration"
          class="badge"
          :class="{ disabled: !configuration.enabled }"
        >{{ configuration.enabled ? '已开放登录' : '尚未开放' }}</span></div>
        <p v-if="loading" class="empty">正在读取配置…</p>
        <form
          v-else
          class="dialog-form wechat-account-form"
          @submit.prevent="submit"
          @input="notice = ''"
        >
          <fieldset :disabled="busy">
            <div class="form-grid">
              <label>服务号 AppID<AdminInput
                v-model="form.appId"
                autocomplete="off"
                placeholder="wx 开头的公众号 AppID"
                required
              /><small>微信支付也使用这个 AppID。</small></label>
              <label><span class="wechat-field-label">服务号 AppSecret<span v-if="form.hasAppSecret" class="wechat-secret-state"><AdminIcon name="lock" :size="12" />已保存</span></span><AdminInput
                v-model="form.appSecret"
                type="password"
                autocomplete="new-password"
                :placeholder="form.hasAppSecret ? '留空保留已保存的密钥' : '填写公众号 AppSecret'"
              /><small>密钥加密保存，更新时才需要重新填写。</small></label>
              <label class="wide">前端网站根地址<AdminInput
                v-model="form.frontendUrl"
                type="url"
                placeholder="https://tboxos.cn"
                required
              /><small>只填写网站根地址，不包含路径、查询参数或 #。</small></label>
            </div>
            <label class="wechat-login-switch"><AdminCheckbox v-model="form.enabled" /><span><strong>开放微信登录</strong><small>微信内自动发起授权，其他浏览器显示扫码登录。</small></span></label>
          </fieldset>
          <div class="wechat-form-footer"><span><AdminIcon name="lock" :size="14" />配置保存后生效</span><AdminButton
            class="primary"
            type="submit"
            :disabled="busy"
          >{{ busy ? '正在保存…' : '保存配置' }}</AdminButton></div>
        </form>
      </section>
      <aside class="wechat-setup-guide" aria-label="微信平台配置参考">
        <div class="wechat-guide-heading"><h2>微信平台需要配置什么？</h2><a
          href="https://mp.weixin.qq.com/"
          target="_blank"
          rel="noreferrer"
        >打开公众平台<AdminIcon name="arrow" :size="14" /></a></div>
        <dl class="wechat-domain-list"><div><dt>网页授权域名</dt><dd>{{ domain }}</dd></div><div><dt>JS 接口安全域名</dt><dd>{{ domain }}</dd></div><div><dt>接口 IP 白名单</dt><dd class="wechat-guide-note">API 服务器的公网出口 IP</dd></div></dl>
        <p>把微信提供的域名校验文件发布到网站根目录，再完成域名验证。</p>
        <div class="wechat-guide-divider" />
        <h3>登录与支付共用公众号</h3><p>支付配置会复用这里的 AppSecret。完成登录验证后，可继续配置资源包支付。</p>
        <a class="wechat-guide-next" href="#/payments">前往微信支付配置<AdminIcon name="arrow" :size="15" /></a>
      </aside>
    </div>
    <div class="wechat-login-footnote"><AdminIcon name="chat" :size="16" /><p>首次授权获取微信资料；站内默认昵称为“方舟”，用户可独立修改头像与昵称。普通用户使用微信登录，管理员账号保持独立。</p></div>
  </div>
</template>
