<script setup lang="ts">
import type { DeviceCapability } from '@t-box/app-contracts'
import { deviceCapabilities, deviceCapabilityLabels } from '@t-box/app-contracts'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onMounted, ref } from 'vue'
import { applicationModules } from '../../applications/registry'
import { appCatalog } from '../app-runtime/catalog'
import { backFromApplication } from '../navigation'
import { identity } from '../session'
import { changeDeviceGrant, deviceGrants, devicePlatform } from './adapter'
import { promptNativeDownload } from './downloads'
import { deviceScope } from './host'

const rows = ref<{ scope: string, name: string, capabilities: DeviceCapability[] }[]>([])
const error = ref('')
const busy = ref(false)
const web = devicePlatform() === 'web'
async function load() {
  error.value = ''
  try {
    const owners = identity.user ? [identity.user.id, undefined] : [undefined]
    const applications = new Map([...appCatalog.entries.map((entry) => [entry.release.appId, entry.release.manifest.name] as const), ...applicationModules.map((module) => [module.manifest.id, module.manifest.name] as const)])
    const result = await Promise.all([...applications].flatMap(([id, name]) => owners.map(async (owner) => {
      const scope = deviceScope(owner, id)
      const capabilities = (await deviceGrants(scope)).filter((value): value is DeviceCapability => deviceCapabilities.includes(value as DeviceCapability))
      return { scope, name: `${name}${!owner && identity.user ? ' · 本地模式' : ''}`, capabilities }
    })))
    rows.value = result.filter((row) => row.capabilities.length)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '设备权限读取失败'
  }
}
async function revoke(scope: string, capability: DeviceCapability) {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await changeDeviceGrant(scope, [capability], false)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '撤销失败'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="device-permissions-page">
    <ApplicationHeader
      title="设备权限"
      back-label="设置"
      @back="backFromApplication"
    />
    <p class="muted">{{ web ? '这里管理当前浏览器中各应用的授权。系统日历、系统设置等本机能力需在 App 中使用。' : '按应用授权，仅在本机生效。撤销后，再次使用会重新询问；系统权限请在系统设置中管理。' }}</p>
    <button
      v-if="web"
      class="button button-secondary"
      @click="promptNativeDownload('本机设备权限', 'ios')"
    >使用本机设备权限</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!rows.length" class="muted">还没有应用获得设备权限。</p>
    <article
      v-for="row in rows"
      :key="row.scope"
      class="permission-group"
    >
      <h2>{{ row.name }}</h2>
      <div
        v-for="capability in row.capabilities"
        :key="capability"
        class="permission-row"
      >
        <span><AppIcon name="check" :size="16" />{{ deviceCapabilityLabels[capability] }}</span>
        <button
          class="button button-secondary"
          :disabled="busy"
          @click="revoke(row.scope, capability)"
        >撤销</button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.device-permissions-page {
  max-width: 760px;
  margin: auto;
  padding: 16px;
}
.device-permissions-page > p {
  font-size: 13px;
  line-height: 1.7;
}
.permission-group {
  border: 1px solid var(--border, #e4e8ec);
  border-radius: 16px;
  margin-top: 16px;
  padding: 16px;
}
.permission-group h2 {
  font-size: 15px;
  margin: 0 0 8px;
}
.permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  gap: 12px;
}
.permission-row > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
</style>
