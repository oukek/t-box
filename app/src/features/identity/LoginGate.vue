<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'
import { navigateTab, openApplication } from '../../core/navigation'
import { showWechatLogin, wechatLogin } from './wechatLogin'

defineProps<{ title: string, description: string }>()
</script>

<template>
  <div class="login-gate">
    <div class="login-gate-intro">
      <span class="identity-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
      <p class="login-gate-eyebrow">T方舟 · 你的日常空间</p>
      <h1>{{ title }}</h1>
      <p class="login-gate-description">{{ description }}</p>
      <div class="login-gate-tools">
        <span>这些工具，可以直接用</span>
        <div>
          <button @click="openApplication({ appId: 'calendar' })"><AppIcon name="calendar" :size="17" />日历</button>
          <button @click="openApplication({ appId: 'time' })"><AppIcon name="clock" :size="17" />时间</button>
          <button @click="navigateTab('applications')">全部应用<AppIcon name="right" :size="14" /></button>
        </div>
      </div>
    </div>
    <section class="login-gate-card" aria-label="微信登录入口">
      <span class="login-gate-account-icon" aria-hidden="true"><AppIcon name="user" :size="25" /></span>
      <h2>登录 T方舟</h2>
      <p>用微信连接你的账号，<br>在不同设备上继续自己的日常。</p>
      <button
        class="wechat-login-primary"
        :disabled="wechatLogin.busy"
        @click="showWechatLogin"
      ><AppIcon name="chat" :size="19" />微信登录<AppIcon name="right" :size="16" /></button>
      <span class="login-gate-note"><AppIcon name="lock" :size="13" />仅云端功能需要登录</span>
    </section>
  </div>
</template>
