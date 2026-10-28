<script setup lang="ts">
import { iconSizeOptions } from '@t-box/app-contracts'
import { appInfo, backFromApplication, identity, navigation, openAccountSettings, openDevicePermissions, openShortcuts, preferences, setPreference, tabLabel } from '@t-box/app-shell-sdk'
import { AppIcon, Modal, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { ref } from 'vue'
import WallpaperSettings from './WallpaperSettings.vue'

const aboutOpen = ref(false)
function sizeKeydown(event: KeyboardEvent) {
  const keys = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
  ]
  if (!keys.includes(event.key)) {
    return
  }
  event.preventDefault()
  const current = iconSizeOptions.findIndex(
    (option) => option.value === preferences.iconSize,
  )
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? iconSizeOptions.length - 1
        : (current +
          (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
          iconSizeOptions.length) %
          iconSizeOptions.length
  setPreference('iconSize', iconSizeOptions[index]!.value)
  const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
  buttons[index]?.focus()
}
</script>

<template>
  <section class="profile-page" aria-label="设置">
    <ApplicationHeader
      title="设置"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    />
    <button
      class="settings-identity"
      aria-label="查看账号信息与安全设置"
      @click="openAccountSettings"
    >
      <UserAvatar :src="identity.user?.avatarUrl" :size="64" />
      <span class="settings-identity-copy">
        <strong>{{ identity.user?.nickname }}</strong>
        <small>微信已登录</small>
        <span>个人信息与账号安全</span>
      </span>
      <AppIcon name="right" :size="18" />
    </button>
    <div class="settings-group">
      <h2>桌面</h2>
      <div class="settings-icon-size">
        <h3>图标大小</h3>
        <div
          class="settings-icon-options"
          role="radiogroup"
          aria-label="桌面图标大小"
          @keydown="sizeKeydown"
        >
          <button
            v-for="option in iconSizeOptions"
            :key="option.value"
            class="settings-icon-option"
            :class="{ selected: preferences.iconSize === option.value }"
            role="radio"
            :aria-checked="preferences.iconSize === option.value"
            :tabindex="preferences.iconSize === option.value ? 0 : -1"
            @click="setPreference('iconSize', option.value)"
          >
            <span
              class="settings-icon-preview"
              :style="{
                '--preview-size': `${option.pixels / 4}px`,
              }"
              aria-hidden="true"
            >
              <i v-for="index in 6" :key="index" />
            </span>
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </button>
        </div>
        <p class="settings-icon-hint">图标大小固定，每行数量随屏幕宽度自动调整。</p>
      </div>
      <p class="settings-device-note">按账号保存，在当前设备生效。</p>
      <WallpaperSettings />
    </div>
    <div class="settings-group">
      <h2>系统集成</h2>
      <div class="profile-menu">
        <button class="profile-action" @click="openDevicePermissions"><span class="profile-action-icon"><AppIcon name="settings" :size="20" /></span><span>设备权限<small>管理各应用的本机能力授权</small></span><AppIcon name="right" :size="17" /></button>
        <button class="profile-action" @click="openShortcuts"><span class="profile-action-icon"><AppIcon name="apps" :size="20" /></span><span>快捷指令<small>配置系统快捷动作</small></span><AppIcon name="right" :size="17" /></button>
      </div>
    </div>
    <div class="settings-group">
      <h2>关于</h2>
      <div class="profile-menu">
        <button class="profile-action" @click="aboutOpen = true">
          <span class="profile-action-icon"><AppIcon
            name="info"
            :size="20"
          /></span>
          <span>关于 {{ appInfo.name }}<small>应用信息与版本</small></span>
          <span class="profile-version">v{{ appInfo.version }}</span>
          <AppIcon name="right" :size="17" />
        </button>
      </div>
    </div>
    <Modal
      :open="aboutOpen"
      :title="`关于 ${appInfo.name}`"
      @close="aboutOpen = false"
    >
      <div class="profile-about">
        <span class="profile-about-icon"><AppIcon
          name="apps"
          :size="26"
        /></span>
        <h3>{{ appInfo.name }}</h3>
        <p class="profile-english-name" lang="en">{{ appInfo.englishName }}</p>
        <p>{{ appInfo.description }}</p>
        <span class="profile-version">版本 {{ appInfo.version }}</span>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.profile-about .profile-english-name {
  margin: 4px 0 12px;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--muted, #708276);
}
</style>
