<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@t-box/ui-kit";
import ApplicationHeader from "@t-box/ui-kit/ApplicationHeader.vue";
import { Modal } from "@t-box/ui-kit";
import { openProfile } from "@t-box/app-shell-sdk";
import { identity } from "@t-box/app-shell-sdk";
import AccountDialog from "./AccountDialog.vue";
import { logout, updateNickname } from "@t-box/app-shell-sdk";
const passwordOpen = ref(false),
  logoutOpen = ref(false),
  signingOut = ref(false);
const nicknameOpen = ref(false),
  nickname = ref(""),
  nicknameError = ref(""),
  nicknameBusy = ref(false),
  nicknameInput = ref<HTMLInputElement>();
const registeredAt = computed(() => {
  const value = identity.user?.createdAt;
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
});
function editNickname() {
  nickname.value = identity.user?.nickname || "";
  nicknameError.value = "";
  nicknameOpen.value = true;
}
async function saveNickname() {
  if (nicknameBusy.value) return;
  nicknameBusy.value = true;
  nicknameError.value = "";
  try {
    await updateNickname(nickname.value.trim());
    nicknameOpen.value = false;
  } catch (cause) {
    nicknameError.value =
      cause instanceof Error ? cause.message : "昵称修改失败";
  } finally {
    nicknameBusy.value = false;
  }
}
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    await logout();
  } catch {
    /* Logout clears the local session even when offline. */
  } finally {
    signingOut.value = false;
    logoutOpen.value = false;
  }
}
</script>
<template>
  <section class="account-settings-page">
    <ApplicationHeader
      title="账号设置"
      back-label="设置"
      @back="openProfile()"
    />
    <div class="settings-group">
      <h2>账号信息</h2>
      <dl class="account-details">
        <div>
          <dt>昵称</dt>
          <dd>
            <button
              class="account-nickname"
              aria-label="修改昵称"
              @click="editNickname"
            >
              {{ identity.user?.nickname }}<AppIcon name="right" :size="16" />
            </button>
          </dd>
        </div>
        <div>
          <dt>账号</dt>
          <dd>{{ identity.user?.username }}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{{ registeredAt }}</dd>
        </div>
      </dl>
    </div>
    <div class="settings-group">
      <h2>安全</h2>
      <div class="profile-menu">
        <button class="profile-action" @click="passwordOpen = true">
          <span class="profile-action-icon"
            ><AppIcon name="lock" :size="19" /></span
          ><span>修改登录密码</span><AppIcon name="right" :size="17" />
        </button>
      </div>
    </div>
    <div class="settings-session-actions">
      <button class="settings-logout" @click="logoutOpen = true">
        <AppIcon name="logout" :size="18" />退出登录
      </button>
    </div>
    <Modal
      :open="nicknameOpen"
      title="修改昵称"
      :busy="nicknameBusy"
      @close="nicknameOpen = false"
      @opened="nicknameInput?.focus()"
      ><form id="nickname-form" @submit.prevent="saveNickname">
        <label class="form-field"
          >昵称<input
            ref="nicknameInput"
            v-model="nickname"
            autocomplete="nickname"
            required
            maxlength="40"
            :disabled="nicknameBusy"
            placeholder="怎么称呼你？"
        /></label>
        <p class="muted">最多 40 个字符，共享账本的成员也会看到此昵称。</p>
        <p v-if="nicknameError" class="form-error" role="alert">
          {{ nicknameError }}
        </p>
      </form>
      <footer class="dialog-footer">
        <button
          type="button"
          class="button button-secondary"
          :disabled="nicknameBusy"
          @click="nicknameOpen = false"
        >
          取消</button
        ><button
          form="nickname-form"
          class="button button-primary"
          :disabled="nicknameBusy || !nickname.trim()"
        >
          {{ nicknameBusy ? "正在保存…" : "保存昵称" }}
        </button>
      </footer></Modal
    >
    <AccountDialog :open="passwordOpen" @close="passwordOpen = false" /><Modal
      :open="logoutOpen"
      title="退出登录？"
      :busy="signingOut"
      @close="logoutOpen = false"
      ><p class="muted">退出后需要重新登录。你的账本、会话和资源会保留。</p>
      <footer class="dialog-footer">
        <button
          class="button button-secondary"
          :disabled="signingOut"
          @click="logoutOpen = false"
        >
          取消</button
        ><button
          class="button button-danger"
          :disabled="signingOut"
          @click="signOut"
        >
          {{ signingOut ? "正在退出…" : "确认退出" }}
        </button>
      </footer></Modal
    >
  </section>
</template>
