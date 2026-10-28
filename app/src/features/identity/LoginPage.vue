<script setup lang="ts">
import { UserAvatar } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted } from 'vue'
import { closeWechatLogin, confirmWechatLogin, copyWechatLink, inWechat, retryWechatLogin, showWechatLogin, startWechatLogin, stopWechatUpdates, wechatLogin } from './wechatLogin'

onMounted(showWechatLogin)
onBeforeUnmount(stopWechatUpdates)
</script>

<template>
  <main class="identity-page">
    <section class="identity-card wechat-login-card" aria-labelledby="wechat-login-title">
      <span class="identity-eyebrow">T方舟 / 日常，一处安放</span>
      <h1 id="wechat-login-title">{{ wechatLogin.phase === 'confirm' ? '确认登录这台设备' : wechatLogin.phase === 'done' ? '已确认登录' : inWechat ? '使用微信登录' : '微信扫码登录' }}</h1>
      <p v-if="wechatLogin.phase === 'confirm'">仅在你正在登录自己的设备时确认。</p>
      <p v-else-if="wechatLogin.phase === 'done'">原设备将自动完成登录，你可以关闭此页面。</p>
      <p v-else>用微信进入自己的空间。默认昵称为“方舟”，登录后可在账号设置中修改头像和昵称。</p>
      <div v-if="wechatLogin.phase === 'qr'" class="wechat-login-qr">
        <div class="qr-image-frame">
          <img
            :src="wechatLogin.qr"
            width="256"
            height="256"
            alt="微信登录二维码，请用微信扫一扫"
          >
          <div
            v-if="wechatLogin.result?.status === 'scanned'"
            class="qr-status-cover"
            role="status"
          ><strong>已扫码</strong><span>请在手机上确认登录</span></div>
        </div>
        <p role="status">{{ wechatLogin.result?.status === 'scanned' ? '扫码成功，请在手机上确认登录' : '打开微信扫一扫，在手机上确认登录' }}</p>
        <small>二维码 5 分钟内有效</small>
      </div>
      <div v-if="wechatLogin.phase === 'confirm' && wechatLogin.result?.user" class="wechat-login-profile">
        <UserAvatar :src="wechatLogin.result.user.avatarUrl" :size="56" />
        <strong>{{ wechatLogin.result.user.nickname }}</strong>
        <span>登录设备：{{ wechatLogin.result.device || '浏览器' }}</span>
      </div>
      <p v-if="['loading', 'redirecting'].includes(wechatLogin.phase)" role="status">{{ wechatLogin.phase === 'redirecting' ? '正在前往微信授权…' : '正在连接微信…' }}</p>
      <p v-if="wechatLogin.phase === 'outside'">请将此链接发送到微信，在微信中打开并确认登录。</p>
      <p
        v-if="wechatLogin.error"
        class="form-error"
        role="alert"
      >{{ wechatLogin.error }}</p>
      <template v-if="wechatLogin.phase === 'confirm'">
        <button
          class="button button-primary"
          :disabled="wechatLogin.busy"
          @click="confirmWechatLogin(true)"
        >{{ wechatLogin.busy ? '正在确认…' : '确认登录' }}</button>
        <button
          class="text-button"
          :disabled="wechatLogin.busy"
          @click="confirmWechatLogin(false)"
        >取消登录</button>
      </template>
      <button
        v-else-if="wechatLogin.phase === 'error'"
        class="button button-primary"
        :disabled="wechatLogin.busy"
        @click="retryWechatLogin"
      >重新尝试</button>
      <button
        v-else-if="wechatLogin.phase === 'idle'"
        class="button button-primary"
        :disabled="wechatLogin.busy"
        @click="startWechatLogin"
      >微信登录</button>
      <button
        v-if="wechatLogin.phase === 'qr'"
        class="text-button"
        @click="startWechatLogin"
      >刷新二维码</button>
      <template v-if="['qr', 'outside'].includes(wechatLogin.phase)">
        <button class="text-button" @click="copyWechatLink">{{ wechatLogin.copied ? '链接已复制' : '在本机微信中登录？复制登录链接' }}</button>
        <a
          v-if="wechatLogin.qrUrl && (wechatLogin.error || wechatLogin.phase === 'outside')"
          class="wechat-login-link"
          :href="wechatLogin.qrUrl"
        >{{ wechatLogin.qrUrl }}</a>
      </template>
      <button
        v-if="wechatLogin.active && !wechatLogin.busy"
        class="text-button"
        @click="closeWechatLogin"
      >{{ wechatLogin.phase === 'done' ? '返回 T方舟' : '暂不登录' }}</button>
    </section>
  </main>
</template>
