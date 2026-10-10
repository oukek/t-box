<script setup lang="ts">
import type { FormValues } from './form'
import { onMounted, ref } from 'vue'
import { featureApi, useFeatureAction } from './api'
import LedgerFormSheet from './LedgerFormSheet.vue'

const props = defineProps<{ ledgerId: string, canWrite: boolean }>()
const api = featureApi(props.ledgerId)
const action = useFeatureAction()
const rows = ref<any[]>([])
const target = ref<any>()
const form = ref<FormValues>({})
async function load() {
  rows.value = await api.get('/bills/trash')
}
async function restore() {
  const path = `/bills/${target.value.id}/restore`
  const r = await action.run(path, {}, (k) => api.write(path, {}, 'POST', k))
  if (r) {
    target.value = undefined
    await load()
  }
}
onMounted(() => load().catch((e) => (action.error.value = e.message)))
</script>

<template>
  <div>
    <div class="feature-toolbar">
      <h2>账单回收站</h2>
    </div>
    <p class="feature-hint">
      恢复会同步修正收支统计和资金账户余额。记账成员只能恢复自己创建的记录。
    </p>
    <div class="feature-card">
      <div
        v-for="row in rows"
        :key="row.id"
        class="feature-row"
      >
        <div>
          <strong>{{ row.type === "income" ? "收入" : "支出" }}
            {{ row.amount }} 元</strong><small>{{ row.date }} · {{ row.note || "无备注" }}</small>
        </div>
        <div v-if="canWrite" class="feature-actions">
          <button
            @click="
              target = row;
              action.error.value = '';
            "
          >
            恢复
          </button>
        </div>
      </div>
      <p v-if="!rows.length" class="feature-empty">回收站是空的。</p>
    </div>
    <p v-if="action.error.value" class="form-error">
      {{ action.error.value }}
    </p>
    <LedgerFormSheet
      v-model="form"
      :open="!!target"
      title="恢复这笔账单"
      :fields="[]"
      :busy="action.busy.value"
      :error="action.error.value"
      :description="
        target
          ? `${target.date} · ${target.amount} 元 · ${target.note || '无备注'}`
          : undefined
      "
      @close="target = undefined"
      @submit="restore"
    />
  </div>
</template>
