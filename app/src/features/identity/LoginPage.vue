<script setup lang="ts">
import { AppIcon, Modal, UserAvatar } from '@t-box/ui-kit'
import { computed, onBeforeUnmount } from 'vue'
import { authorizeWechatProfile, closeWechatLogin, confirmWechatLogin, copyWechatLink, inWechat, retryWechatLogin, startWechatLogin, stopWechatUpdates, wechatLogin } from './wechatLogin'

const title = computed(() => wechatLogin.phase === 'profile' ? '确认微信登录' : wechatLogin.phase === 'confirm' ? '确认登录设备' : wechatLogin.phase === 'done' ? '登录已确认' : '微信登录')
onBeforeUnmount(stopWechatUpdates)
</script>

<template>
  <Modal
    class="wechat-login-dialog"
    :open="wechatLogin.active"
    :title="title"
    @close="closeWechatLogin"
  >
    <div class="wechat-login-content">
      <div class="wechat-login-brand"><span class="identity-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>T方舟<small>日常，一处安放</small></span></div>
      <template v-if="wechatLogin.phase === 'profile'">
        <div class="wechat-profile-request">
          <span class="wechat-profile-icon"><AppIcon name="user" :size="23" /><i><AppIcon name="check" :size="11" /></i></span>
          <div><strong>微信身份已识别</strong><span>再确认一次，就可以进入自己的账号。</span></div>
        </div>
        <p class="wechat-login-description">继续登录需要你授权微信昵称和头像。站内头像与昵称可在登录后自行修改。</p>
        <button
          class="wechat-login-primary"
          :disabled="wechatLogin.busy"
          @click="authorizeWechatProfile"
        >{{ wechatLogin.busy ? '正在前往微信…' : '授权昵称和头像，继续登录' }}<AppIcon name="right" :size="16" /></button>
      </template>
      <template v-else-if="wechatLogin.phase === 'qr'">
        <div class="wechat-login-qr">
          <div class="qr-image-frame">
            <img
              :src="wechatLogin.qr"
              width="224"
              height="224"
              alt="微信登录二维码，请用微信扫一扫"
            >
            <div
              v-if="wechatLogin.result?.status === 'scanned'"
              class="qr-status-cover"
              role="status"
            ><AppIcon name="check" :size="32" /><strong>已扫码</strong><span>请在手机上确认登录</span></div>
          </div>
          <p role="status">{{ wechatLogin.result?.status === 'scanned' ? '等待手机确认' : '打开微信，扫一扫登录' }}</p>
          <span class="wechat-qr-caption">二维码 5 分钟内有效<button @click="startWechatLogin"><AppIcon name="refresh" :size="12" />刷新</button></span>
        </div>
        <button class="wechat-login-secondary" @click="copyWechatLink"><AppIcon name="link" :size="15" />{{ wechatLogin.copied ? '登录链接已复制' : '在本机微信登录？复制链接' }}</button>
      </template>
      <template v-else-if="wechatLogin.phase === 'confirm' && wechatLogin.result?.user">
        <div class="wechat-login-profile"><UserAvatar :src="wechatLogin.result.user.avatarUrl" :size="60" /><strong>{{ wechatLogin.result.user.nickname }}</strong><span>正在登录 {{ wechatLogin.result.device || '浏览器' }}</span></div>
        <p class="wechat-login-description">请确认这是你正在使用的设备。</p>
        <button
          class="wechat-login-primary"
          :disabled="wechatLogin.busy"
          @click="confirmWechatLogin(true)"
        >{{ wechatLogin.busy ? '正在确认…' : '确认登录这台设备' }}<AppIcon name="right" :size="16" /></button>
        <button
          class="wechat-login-secondary"
          :disabled="wechatLogin.busy"
          @click="confirmWechatLogin(false)"
        >取消这次登录</button>
      </template>
      <template v-else-if="wechatLogin.phase === 'done'">
        <span class="wechat-login-success"><AppIcon name="check" :size="30" /></span>
        <p class="wechat-login-description">原设备已完成登录，可以关闭此页面。</p>
      </template>
      <template v-else-if="['loading', 'redirecting'].includes(wechatLogin.phase)">
        <div class="wechat-login-connecting" role="status"><span class="wechat-login-spinner" /><strong>{{ wechatLogin.phase === 'redirecting' ? '正在前往微信…' : '正在连接微信…' }}</strong><span>请稍候，你仍可关闭窗口使用本地工具。</span></div>
      </template>
      <template v-else-if="wechatLogin.phase === 'outside'">
        <p class="wechat-login-description">请复制链接到微信打开，再确认登录原设备。</p>
        <button class="wechat-login-primary" @click="copyWechatLink"><AppIcon name="copy" :size="17" />{{ wechatLogin.copied ? '登录链接已复制' : '复制登录链接' }}</button>
      </template>
      <button
        v-else-if="wechatLogin.phase === 'idle'"
        class="wechat-login-primary"
        :disabled="wechatLogin.busy"
        @click="startWechatLogin"
      >{{ inWechat ? '继续微信登录' : '显示登录二维码' }}<AppIcon name="right" :size="16" /></button>
      <p
        v-if="wechatLogin.error"
        class="wechat-login-error"
        role="alert"
      ><AppIcon name="info" :size="16" />{{ wechatLogin.error }}</p>
      <button
        v-if="wechatLogin.phase === 'error'"
        class="wechat-login-primary"
        :disabled="wechatLogin.busy"
        @click="retryWechatLogin"
      >重新尝试<AppIcon name="refresh" :size="16" /></button>
      <a
        v-if="wechatLogin.qrUrl && (wechatLogin.error || wechatLogin.phase === 'outside')"
        class="wechat-login-link"
        :href="wechatLogin.qrUrl"
      >{{ wechatLogin.qrUrl }}</a>
      <div class="wechat-login-footer"><button @click="closeWechatLogin">{{ wechatLogin.phase === 'done' ? '返回 T方舟' : '暂不登录' }}</button></div>
    </div>
  </Modal>
</template>
