<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon, Modal } from "@t-box/ui-kit";
import ApplicationHeader from "@t-box/ui-kit/ApplicationHeader.vue";
import { appInfo } from "@t-box/app-shell-sdk";
import { identity } from "@t-box/app-shell-sdk";
import { preferences, setPreference } from "@t-box/app-shell-sdk";
import { iconSizeOptions } from "@t-box/app-contracts";
import {
  openAccountSettings,
  backFromApplication,
  navigation,
  tabLabel,
} from "@t-box/app-shell-sdk";
const aboutOpen = ref(false);
const avatar = computed(() => [...(identity.user?.nickname || "我")][0]);
function sizeKeydown(event: KeyboardEvent) {
  const keys = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const current = iconSizeOptions.findIndex(
    (option) => option.value === preferences.iconSize,
  );
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? iconSizeOptions.length - 1
        : (current +
            (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
            iconSizeOptions.length) %
          iconSizeOptions.length;
  setPreference("iconSize", iconSizeOptions[index]!.value);
  (event.currentTarget as HTMLElement)
    .querySelectorAll<HTMLButtonElement>("button")
    [index]?.focus();
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
      <span class="profile-avatar" aria-hidden="true">{{ avatar }}</span>
      <span class="settings-identity-copy">
        <strong>{{ identity.user?.nickname }}</strong>
        <small>@{{ identity.user?.username }}</small>
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
                '--preview-columns': option.columns,
                '--preview-size': `${20 - option.columns * 2}px`,
              }"
              aria-hidden="true"
            >
              <i v-for="index in option.columns * 2" :key="index"></i>
            </span>
            <strong>{{ option.label }}</strong>
            <small>每行 {{ option.columns }} 个</small>
          </button>
        </div>
      </div>
      <p class="settings-device-note">按账号保存，在当前设备生效。</p>
    </div>
    <div class="settings-group">
      <h2>关于</h2>
      <div class="profile-menu">
        <button class="profile-action" @click="aboutOpen = true">
          <span class="profile-action-icon"
            ><AppIcon name="info" :size="20"
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
        <span class="profile-about-icon"
          ><AppIcon name="apps" :size="26"
        /></span>
        <h3>{{ appInfo.name }}</h3>
        <p>{{ appInfo.description }}</p>
        <span class="profile-version">版本 {{ appInfo.version }}</span>
      </div>
    </Modal>
  </section>
</template>
