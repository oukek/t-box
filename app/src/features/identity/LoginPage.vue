<script setup lang="ts">
import { ref } from "vue";
import { authenticate } from "./identityApi";
const mode = ref<"login" | "register">("login"),
  username = ref(""),
  password = ref(""),
  nickname = ref(""),
  error = ref(""),
  busy = ref(false);
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await authenticate(mode.value, {
      username: username.value.trim(),
      password: password.value,
      ...(mode.value === "register"
        ? { nickname: nickname.value.trim() || username.value.trim() }
        : {}),
    });
    password.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "登录失败";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="identity-page">
    <form class="identity-card" @submit.prevent="submit">
      <span class="eyebrow">T BOX / 日常，一处安放</span>
      <h1>{{ mode === "login" ? "欢迎回来。" : "开始记录生活。" }}</h1>
      <p>对话、创作与日常工具，都在自己的空间里。</p>
      <fieldset :disabled="busy" class="form-fields">
        <legend class="sr-only">账号信息</legend>
        <label class="form-field"
          >账号<input
            v-model="username"
            autocomplete="username"
            minlength="3"
            maxlength="64"
            required
            placeholder="账号，至少 3 个字符" /></label
        ><label v-if="mode === 'register'" class="form-field"
          >昵称<input
            v-model="nickname"
            maxlength="40"
            autocomplete="nickname"
            placeholder="怎么称呼你？" /></label
        ><label class="form-field"
          >密码<input
            v-model="password"
            type="password"
            :autocomplete="
              mode === 'login' ? 'current-password' : 'new-password'
            "
            minlength="6"
            maxlength="128"
            required
            placeholder="至少 6 个字符"
        /></label>
      </fieldset>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button-primary" :disabled="busy">
        {{ busy ? "请稍候…" : mode === "login" ? "登录" : "创建账号" }}</button
      ><button
        type="button"
        class="text-button"
        :disabled="busy"
        @click="
          mode = mode === 'login' ? 'register' : 'login';
          error = '';
        "
      >
        {{ mode === "login" ? "没有账号？注册" : "已有账号？登录" }}
      </button>
    </form>
  </main>
</template>
