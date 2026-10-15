<script setup lang="ts">
import ReminderHost from '@t-box/device-reminders/ReminderHost.vue'
import AccountSettingsPage from '@t-box/settings-web/pages/AccountSettingsPage.vue'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { applicationModules } from './applications/registry'
import ApplicationLaunch from './core/app-runtime/ApplicationLaunch.vue'
import ApplicationView from './core/app-runtime/ApplicationView.vue'
import { closeApplicationRuntimes } from './core/app-runtime/bridge'
import {
  appCatalog,
  isInstalled,
  repairInstallation,
} from './core/app-runtime/catalog'
import { startCatalogSync } from './core/app-runtime/catalogSync'
import { shellVersionCompatible } from './core/app-runtime/compatibility'
import { clearApplicationBindings } from './core/app-runtime/resourceBindings'
import { getApplication } from './core/applications'
import { online } from './core/connectivity'
import {
  backFromApplication,
  navigateTab,
  navigation,
  openApplication,
  primaryTabs,
  startNavigation,
  tabLabel,
} from './core/navigation'
import { identity } from './core/session'
import { observeViewport } from './core/viewport'
import ApplicationCapabilitiesPage from './features/applications/ApplicationCapabilitiesPage.vue'
import ApplicationsPage from './features/applications/ApplicationsPage.vue'
import { recoverNativeCheckout } from './features/billing/pendingCheckout'
import PricingPage from './features/billing/PricingPage.vue'
import RechargePage from './features/billing/RechargePage.vue'
import WalletPage from './features/billing/WalletPage.vue'
import ChatPage from './features/chat/ChatPage.vue'
import { startChat, stopChat } from './features/chat/chatStore'
import { restoreSession } from './features/identity/identityApi'
import LoginPage from './features/identity/LoginPage.vue'
import ResourcesPage from './features/resources/ResourcesPage.vue'

const currentApplication = computed(() =>
  navigation.application
    ? getApplication(navigation.application.appId)
    : undefined,
)
const showPrimaryNavigation = computed(() =>
  ['home', 'applications'].includes(navigation.screen),
)
const currentView = computed(() =>
  navigation.application
    ? applicationModules.find(
        (module) => module.manifest.id === navigation.application!.appId,
      )
    : null,
)
const currentInstallation = computed(() => appCatalog.entries.find((e) => e.release.appId === navigation.application?.appId)?.installation)
const installationError = computed(() => appCatalog.error || currentInstallation.value?.error || '')
async function retryCurrentApplication() {
  const id = navigation.application?.appId
  if (!id) {
    return
  }
  try {
    await repairInstallation(id)
  } catch (cause) {
    appCatalog.error = cause instanceof Error ? cause.message : '应用修复失败'
  }
}
const stopCatalogSync = startCatalogSync()
function hostCompatible(appId: string) {
  const entry = appCatalog.entries.find((e) => e.release.appId === appId)
  const module = applicationModules.find((m) => m.manifest.id === appId)
  return entry?.release.runtime.type !== 'shell' || !entry.installation?.version || !!(module && shellVersionCompatible(entry.installation.version, module.manifest.version, module.shellCompatibility?.minimumVersion))
}
const currentCompatible = computed(
  () =>
    !currentView.value ||
    hostCompatible(currentView.value.manifest.id),
)
let stopViewport: (() => void) | undefined
const isWebHost = !window.Capacitor?.isNativePlatform?.()
function reloadHost() {
  location.reload()
}
function focusWorkspace() {
  document.getElementById('workspace')?.focus()
}
watch(
  () => identity.user?.id,
  (id) => {
    stopChat()
    closeApplicationRuntimes()
    clearApplicationBindings()
    if (id) {
      startChat()
      void recoverNativeCheckout()
    }
  },
  { immediate: true },
)
onMounted(() => {
  startNavigation()
  void restoreSession()
  stopViewport = observeViewport()
})
onBeforeUnmount(() => {
  stopCatalogSync()
  stopChat()
  stopViewport?.()
})
</script>

<template>
  <aside
    v-if="!online"
    class="offline-banner"
    role="status"
  >当前离线，联网后可继续。记账、AI 和支付操作需要网络。</aside>
  <div
    v-if="!identity.ready"
    class="identity-page"
    role="status"
  >
    <p>{{ identity.error || "正在恢复账号…" }}</p>
    <button
      v-if="identity.error"
      class="button button-secondary"
      @click="restoreSession"
    >
      重新连接
    </button>
  </div>
  <LoginPage v-else-if="!identity.user" />
  <div
    v-else
    class="super-app"
    :class="{ 'super-app--detail': !showPrimaryNavigation }"
  >
    <a
      class="skip-link"
      href="#workspace"
      @click.prevent="focusWorkspace"
    >跳到主要内容</a>
    <main
      id="workspace"
      class="workspace-plane"
      :class="{
        'workspace-plane--desktop': navigation.screen === 'applications',
        'workspace-plane--billing': ['wallet', 'recharge', 'pricing'].includes(
          navigation.screen,
        ),
      }"
      tabindex="-1"
    >
      <ChatPage
        v-show="navigation.screen === 'home'"
        :active="navigation.screen === 'home'"
      />
      <ApplicationsPage v-show="navigation.screen === 'applications'" />
      <ApplicationCapabilitiesPage
        v-if="
          navigation.screen === 'capabilities' && navigation.capabilityAppId
        "
        :app-id="navigation.capabilityAppId"
      />
      <WalletPage v-if="navigation.screen === 'wallet'" />
      <RechargePage v-if="navigation.screen === 'recharge'" />
      <PricingPage v-if="navigation.screen === 'pricing'" />
      <ResourcesPage v-if="navigation.screen === 'resources'" />
      <AccountSettingsPage v-if="navigation.screen === 'account'" />
      <ApplicationView
        v-if="navigation.screen === 'application' && currentApplication && currentView && isInstalled(currentApplication.id) && currentCompatible"
        :key="currentApplication.id"
        :module="currentView"
        :application="currentApplication"
        :params="navigation.application?.params || {}"
        :open-revision="navigation.revision"
      />
      <section
        v-else-if="navigation.screen === 'application' && currentApplication"
        class="application-unavailable"
      >
        <ApplicationHeader
          :title="currentApplication.name"
          :back-label="tabLabel(navigation.backTo)"
          @back="backFromApplication"
        />
        <ApplicationLaunch
          v-if="appCatalog.loading || currentInstallation?.status === 'installing'"
          :application="currentApplication"
          stage="resolving"
        />
        <div v-else class="application-unavailable-body">
          <AppIcon name="apps" :size="28" />
          <h2>
            {{
              appCatalog.loading
                ? "正在读取应用…"
                : !currentCompatible
                  ? "需要更新宿主应用"
                  : currentInstallation?.status === 'failed'
                    ? "应用暂不可用"
                    : "此应用尚未安装"
            }}
          </h2>
          <p v-if="!appCatalog.loading">
            {{
              installationError || (!currentCompatible
                ? (isWebHost ? "请刷新网页后重试。" : "请更新 T Box 应用后再打开。")
                : "安装后可以继续使用，卸载前保存的数据仍然保留。")
            }}
          </p>
          <button
            v-if="!currentCompatible && isWebHost"
            class="button button-primary"
            @click="reloadHost"
          >刷新网页</button>
          <button
            v-if="currentInstallation && currentInstallation.status !== 'active'"
            class="button button-primary"
            @click="retryCurrentApplication"
          >重试安装</button>
          <button
            v-if="!appCatalog.loading && currentApplication.id !== 'market' && isInstalled('market') && hostCompatible('market')"
            class="button button-primary"
            @click="openApplication({ appId: 'market' })"
          >
            打开应用市场
          </button>
        </div>
      </section>
    </main>
    <nav
      v-if="showPrimaryNavigation"
      class="bottom-navigation"
      aria-label="主要导航"
    >
      <div>
        <button
          v-for="tab in primaryTabs"
          :key="tab.id"
          :class="{
            active:
              (navigation.screen === 'home' ? 'home' : 'applications')
              === tab.id,
          }"
          :aria-current="
            (navigation.screen === 'home' ? 'home' : 'applications') === tab.id
              ? 'page'
              : undefined
          "
          @click="navigateTab(tab.id)"
        >
          <AppIcon :name="tab.icon" :size="21" /><span>{{ tab.label }}</span>
        </button>
      </div>
    </nav>
    <ReminderHost />
    <template v-for="module in applicationModules" :key="module.manifest.id">
      <component
        :is="module.host"
        v-if="
          module.host
            && isInstalled(module.manifest.id)
            && hostCompatible(module.manifest.id)
        "
      />
    </template>
  </div>
</template>

<style scoped>
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
