<script setup lang="ts">
import { ref, onMounted } from "vue";
import { featureApi } from "./api";
const props = defineProps<{ ledgerId: string }>(),
  api = featureApi(props.ledgerId),
  rows = ref<any[]>([]),
  error = ref("");
async function load() {
  try {
    rows.value = await api.get("/notices");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function read(id: string) {
  try {
    await api.write(`/notices/${id}`, {}, "PATCH");
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
</script>
<template>
  <div>
    <div class="feature-toolbar">
      <h2>账本提醒</h2>
      <button class="button button-secondary" @click="load">刷新</button>
    </div>
    <p class="feature-hint">
      周期账单、往来到期和预算提醒保存在这里。后台每分钟检查一次；当前为应用内提醒。
    </p>
    <div v-for="row in rows" :key="row.id" class="feature-card">
      <div class="feature-row">
        <div>
          <strong>{{ row.title }}</strong
          ><small>{{ row.body }}</small>
        </div>
        <div v-if="!Number(row.read)" class="feature-actions">
          <button @click="read(row.id)">标为已读</button>
        </div>
      </div>
    </div>
    <p v-if="!rows.length" class="feature-empty">暂无提醒。</p>
    <p v-if="error" class="form-error">{{ error }}</p>
  </div>
</template>
