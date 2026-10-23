<script setup lang="ts">
import type { HostDownloadSettings } from '@t-box/app-contracts'
import { defaultHostDownloads } from '@t-box/app-contracts'
import { onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import { errorMessage, request, save } from '../core/api'

const current = ref<HostDownloadSettings>({ ...defaultHostDownloads })
const form = reactive({ ...defaultHostDownloads })
const ready = ref(false)
const open = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
async function load() {
  error.value = ''
  try {
    current.value = await request<HostDownloadSettings>('/host/downloads')
    ready.value = true
  } catch (cause) {
    error.value = errorMessage(cause)
  }
}
function edit() {
  Object.assign(form, current.value)
  error.value = ''
  notice.value = ''
  open.value = true
}
async function submit() {
  if (busy.value || !ready.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    current.value = await save<HostDownloadSettings>('/host/downloads', form, 'PATCH')
    open.value = false
    notice.value = '下载引导已保存'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="panel host-download-settings">
    <div><h2>客户端下载</h2><p>网页使用本机功能时，引导下载宿主 App。iOS 使用 App Store 链接。</p><small v-if="ready">iOS {{ current.iosAppStoreUrl ? '已配置' : '未配置' }} · Android {{ current.androidDownloadUrl ? '已配置' : '未配置' }}</small><small v-if="notice" role="status">{{ notice }}</small></div>
    <AdminButton v-if="ready" @click="edit">配置下载引导</AdminButton>
    <AdminButton v-else @click="load">重新加载</AdminButton>
    <p
      v-if="error && !open"
      class="alert"
      role="alert"
    >{{ error }}</p>
  </section>
  <AdminDialog
    :open="open"
    title="客户端下载引导"
    :busy="busy"
    @close="open = false"
  >
    <form
      id="host-download-settings"
      class="form-grid"
      @submit.prevent="submit"
    >
      <p
        v-if="error"
        class="alert"
        role="alert"
      >{{ error }}</p>
      <label>下载提示中的应用名称<AdminInput
        v-model="form.displayName"
        required
        maxlength="40"
        autocomplete="off"
      /><small>只影响下载提示，不修改应用包名、系统快捷指令或已上架名称。</small></label>
      <label>iOS App Store 地址<AdminInput
        v-model="form.iosAppStoreUrl"
        type="url"
        placeholder="https://apps.apple.com/cn/app/id…"
        maxlength="2048"
      /><small>填写实际应用详情页。未上架时留空，前端显示下载地址暂未开放。</small></label>
      <label>Android 下载地址<AdminInput
        v-model="form.androidDownloadUrl"
        type="url"
        placeholder="https://…"
        maxlength="2048"
      /><small>填写官方应用商店或官方下载页的 HTTPS 地址，可留空。</small></label>
    </form>
    <template #footer><AdminButton :disabled="busy" @click="open = false">取消</AdminButton><AdminButton
      class="primary"
      type="submit"
      form="host-download-settings"
      :disabled="busy"
    >{{ busy ? '保存中…' : '保存下载引导' }}</AdminButton></template>
  </AdminDialog>
</template>

<style scoped>
.host-download-settings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
  margin-bottom: 16px;
}
.host-download-settings > div {
  flex: 1;
  min-width: 220px;
}
.host-download-settings h2 {
  font-size: 14px;
  margin: 0 0 5px;
}
.host-download-settings p {
  font-size: 12px;
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}
.host-download-settings small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.host-download-settings .alert {
  width: 100%;
}
</style>
