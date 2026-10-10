<script setup lang="ts">
import AccountSettingsPage from '@t-box/settings-web/pages/AccountSettingsPage.vue'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { applicationModules } from './applications/registry'
import { closeApplicationRuntimes } from './core/app-runtime/bridge'
import {
  appCatalog,
  isInstalled,
  refreshCatalog,
} from './core/app-runtime/catalog'
import { getApplication } from './core/applications'
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
function hostCompatible(appId: string, version: string) {
  const entry = appCatalog.entries.find((e) => e.release.appId === appId)
  return (
    entry?.release.runtime.type !== 'shell' ||
    !entry.installation?.version ||
    entry.installation.version === version
  )
}
const currentCompatible = computed(
  () =>
    !currentView.value ||
    hostCompatible(
      currentView.value.manifest.id,
      currentView.value.manifest.version,
    ),
)
let stopViewport: (() => void) | undefined
function focusWorkspace() {
  document.getElementById('workspace')?.focus()
}
watch(
  () => identity.user?.id,
  (id) => {
    stopChat()
    closeApplicationRuntimes()
    void refreshCatalog()
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
  stopChat()
  stopViewport?.()
})
</script>

<template>
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
      <section
        v-if="
          navigation.screen === 'application'
            && currentApplication
            && currentView
            && isInstalled(currentApplication.id)
            && currentCompatible
        "
        class="application-workspace"
      >
        <ApplicationHeader
          v-if="currentView.navigation === 'shell'"
          :title="currentApplication.name"
          :back-label="tabLabel(navigation.backTo)"
          @back="backFromApplication"
        />
        <component
          :is="currentView.component"
          v-bind="
            currentView.props(navigation.application?.params || {}, {
              openRevision: navigation.revision,
            })
          "
        />
      </section>
      <section
        v-else-if="navigation.screen === 'application' && currentApplication"
        class="application-unavailable"
      >
        <AppIcon name="apps" :size="28" />
        <h2>
          {{
            appCatalog.loading
              ? "正在读取应用…"
              : !currentCompatible
                ? "需要更新宿主应用"
                : "此应用尚未安装"
          }}
        </h2>
        <p v-if="!appCatalog.loading">
          {{
            !currentCompatible
              ? "请刷新网页，或更新 T Box 应用后再打开。"
              : "安装后可以继续使用，卸载前保存的数据仍然保留。"
          }}
        </p>
        <button
          v-if="!appCatalog.loading"
          class="button button-primary"
          @click="openApplication({ appId: 'market' })"
        >
          打开应用市场
        </button>
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
    <template v-for="module in applicationModules" :key="module.manifest.id">
      <component
        :is="module.host"
        v-if="
          module.host
            && isInstalled(module.manifest.id)
            && hostCompatible(module.manifest.id, module.manifest.version)
        "
      />
    </template>
  </div>
</template>

<style scoped>
.application-unavailable {
  margin: auto;
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
