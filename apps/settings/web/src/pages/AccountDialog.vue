<script setup lang="ts">
import { ref } from "vue";
import { Modal } from "@t-box/ui-kit";
import { changePassword } from "@t-box/app-shell-sdk";
import { identity } from "@t-box/app-shell-sdk";
const props = defineProps<{ open: boolean }>(),
  emit = defineEmits<{ close: [] }>(),
  current = ref(""),
  next = ref(""),
  error = ref(""),
  busy = ref(false);
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await changePassword(current.value, next.value);
    current.value = "";
    next.value = "";
    emit("close");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "修改失败";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Modal :open="props.open" title="账号设置" :busy="busy" @close="emit('close')"
    ><p class="muted">
      {{ identity.user?.nickname }} · @{{ identity.user?.username }}
    </p>
    <form @submit.prevent="save">
      <fieldset class="form-fields" :disabled="busy">
        <legend class="sr-only">修改账号密码</legend>
        <label class="form-field"
          >当前密码<input
            v-model="current"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128" /></label
        ><label class="form-field"
          >新密码<input
            v-model="next"
            type="password"
            autocomplete="new-password"
            required
            minlength="6"
            maxlength="128"
            placeholder="至少 6 个字符"
        /></label>
      </fieldset>
      <p class="muted">修改后所有设备需要重新登录，账本和记录保持不变。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer class="dialog-footer">
        <button
          type="button"
          class="button button-secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          取消</button
        ><button class="button button-primary" :disabled="busy">
          {{ busy ? "正在保存…" : "修改密码" }}
        </button>
      </footer>
    </form></Modal
  >
</template>
