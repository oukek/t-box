<script setup lang="ts">
import type { ApplicationDestination } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed } from 'vue'
import { applicationModules } from '../../applications/registry'
import LoginGate from '../../features/identity/LoginGate.vue'
import { getApplication } from '../applications'
import { backFromApplication, navigation, openApplication, tabLabel } from '../navigation'
import { identity } from '../session'
import ApplicationLaunch from './ApplicationLaunch.vue'
import ApplicationView from './ApplicationView.vue'
import { appCatalog, isInstalled, repairInstallation } from './catalog'
import { shellVersionCompatible } from './compatibility'
import { localApplications } from './localApplications'

const props = defineProps<{ destination: ApplicationDestination, openRevision: number, embedded?: boolean }>()
const application = computed(() => getApplication(props.destination.appId))
const module = computed(() => applicationModules.find((module) => module.manifest.id === props.destination.appId))
const installation = computed(() => appCatalog.entries.find((entry) => entry.release.appId === props.destination.appId)?.installation)
const loginRequired = computed(() => !identity.user && !localApplications.releases.some((release) => release.appId === props.destination.appId))
const isWebHost = !window.Capacitor?.isNativePlatform?.()
function hostCompatible(appId: string) {
  const entry = appCatalog.entries.find((entry) => entry.release.appId === appId)
  const target = applicationModules.find((module) => module.manifest.id === appId)
  return entry?.release.runtime.type !== 'shell' || !entry.installation?.version || !!(target && shellVersionCompatible(entry.installation.version, target.manifest.version, target.shellCompatibility?.minimumVersion))
}
const compatible = computed(() => hostCompatible(props.destination.appId))
const error = computed(() => appCatalog.error || installation.value?.error || '')
async function repair() {
  try {
    await repairInstallation(props.destination.appId)
  } catch (cause) {
    appCatalog.error = cause instanceof Error ? cause.message : '应用修复失败'
  }
}
function reloadHost() {
  location.reload()
}
</script>

<template>
  <section v-if="loginRequired" class="application-surface-login">
    <ApplicationHeader
      v-if="!embedded"
      :title="application?.name || '登录'"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    />
    <LoginGate :title="application?.name || '个人空间'" description="此功能需要登录账号。日历、时间等本地工具可以继续使用。" />
  </section>
  <ApplicationView
    v-else-if="application && module && isInstalled(application.id) && compatible"
    :key="application.id"
    :module="module"
    :application="application"
    :params="destination.params || {}"
    :open-revision="openRevision"
    :embedded="embedded"
  />
  <section v-else-if="application" class="application-unavailable">
    <ApplicationHeader
      v-if="!embedded"
      :title="application.name"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    />
    <ApplicationLaunch
      v-if="appCatalog.loading || installation?.status === 'installing'"
      :application="application"
      stage="resolving"
    />
    <div v-else class="application-unavailable-body">
      <AppIcon name="apps" :size="28" />
      <h2>{{ !compatible ? '需要更新宿主应用' : installation?.status === 'failed' ? '应用暂不可用' : '此应用尚未安装' }}</h2>
      <p>{{ error || (!compatible ? (isWebHost ? '请刷新网页后重试。' : '请更新 T方舟 应用后再打开。') : '安装后可以继续使用，卸载前保存的数据仍然保留。') }}</p>
      <button
        v-if="!compatible && isWebHost"
        class="button button-primary"
        @click="reloadHost"
      >刷新网页</button>
      <button
        v-if="installation && installation.status !== 'active'"
        class="button button-primary"
        @click="repair"
      >重试安装</button>
      <button
        v-if="application.id !== 'market' && isInstalled('market') && hostCompatible('market')"
        class="button button-primary"
        @click="openApplication({ appId: 'market' })"
      >打开应用市场</button>
    </div>
  </section>
</template>

<style scoped>
.application-surface-login {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.application-unavailable {
  margin: 0 auto;
  width: 100%;
  max-width: 1220px;
}
.application-unavailable-body {
  padding: 48px 20px;
  text-align: center;
  color: var(--muted);
}
.application-unavailable h2 {
  font-size: 18px;
  color: var(--text);
  margin: 16px 0 8px;
}
.application-unavailable p {
  font-size: 14px;
  margin-bottom: 20px;
}
</style>
