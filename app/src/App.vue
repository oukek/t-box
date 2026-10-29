<script setup lang="ts">
import ReminderHost from '@t-box/device-reminders/ReminderHost.vue'
import AccountSettingsPage from '@t-box/settings-web/pages/AccountSettingsPage.vue'
import { AppIcon, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { applicationModules } from './applications/registry'
import ApplicationSurface from './core/app-runtime/ApplicationSurface.vue'
import ApplicationWindow from './core/app-runtime/ApplicationWindow.vue'
import { closeApplicationRuntimes } from './core/app-runtime/bridge'
import {
  appCatalog,
  isInstalled,
} from './core/app-runtime/catalog'
import { startCatalogSync } from './core/app-runtime/catalogSync'
import { shellVersionCompatible } from './core/app-runtime/compatibility'
import { localApplications } from './core/app-runtime/localApplications'
import { clearApplicationBindings } from './core/app-runtime/resourceBindings'
import { getApplication } from './core/applications'
import { online } from './core/connectivity'
import DeviceConsentDialog from './core/native-runtime/DeviceConsentDialog.vue'
import DevicePermissionsPage from './core/native-runtime/DevicePermissionsPage.vue'
import { startNativeRuntime } from './core/native-runtime/lifecycle'
import NativeDownloadDialog from './core/native-runtime/NativeDownloadDialog.vue'
import ShortcutsPage from './core/native-runtime/ShortcutsPage.vue'
import {
  closeApplicationWindow,
  navigateTab,
  navigation,
  openDevicePermissions,
  openProfile,
  primaryTabs,
  startNavigation,
} from './core/navigation'
import { identity } from './core/session'
import { observeViewport } from './core/viewport'
import ApplicationCapabilitiesPage from './features/applications/ApplicationCapabilitiesPage.vue'
import ApplicationsPage from './features/applications/ApplicationsPage.vue'
import PaymentHandoffPage from './features/billing/PaymentHandoffPage.vue'
import { recoverNativeCheckout } from './features/billing/pendingCheckout'
import PricingPage from './features/billing/PricingPage.vue'
import RechargePage from './features/billing/RechargePage.vue'
import WalletPage from './features/billing/WalletPage.vue'
import ChatPage from './features/chat/ChatPage.vue'
import { startChat, stopChat } from './features/chat/chatStore'
import MemoryConfirmationDialog from './features/chat/MemoryConfirmationDialog.vue'
import MemoryPage from './features/chat/MemoryPage.vue'
import LoginGate from './features/identity/LoginGate.vue'
import LoginPage from './features/identity/LoginPage.vue'
import { initializeWechatLogin, showWechatLogin } from './features/identity/wechatLogin'
import PromotionShareDialog from './features/promotions/PromotionShareDialog.vue'
import { openPromotionShare } from './features/promotions/share'
import ResourcesPage from './features/resources/ResourcesPage.vue'

const currentApplication = computed(() =>
  navigation.application
    ? getApplication(navigation.application.appId)
    : undefined,
)
const showPrimaryNavigation = computed(() =>
  ['home', 'applications'].includes(navigation.screen),
)
const loginRequired = computed(() => !identity.user && !['devicePermissions', 'shortcuts', 'paymentHandoff'].includes(navigation.screen) && (navigation.screen !== 'applications' && (navigation.screen !== 'application' || !localApplications.releases.some((release) => release.appId === navigation.application?.appId))))
const loginPrompt = computed(() => {
  const pages: Record<string, [string, string]> = {
    home: ['和方舟，聊聊日常', '聊想法、排日程、整理记录。登录后，对话可以在不同设备间接着聊。'],
    wallet: ['服务余额', '登录后查看余额与使用记录，管理自己的资源包。'],
    recharge: ['购买资源包', '登录后选择资源包，为自己的账号充值。'],
    resources: ['我的文件', '登录后查看和管理自己的文件，在不同设备间同步。'],
    memory: ['记忆管理', '登录后查看和管理方舟记住的个人信息。'],
    account: ['个人资料', '登录后修改头像、昵称，管理自己的账号。'],
  }
  const [title, description] = pages[navigation.screen] ?? [currentApplication.value?.name || '个人空间', '此功能需要登录账号。日历、时间等本地工具可以继续使用。']
  return { title, description }
})
const stopCatalogSync = startCatalogSync()
const stopNativeRuntime = startNativeRuntime()
function hostCompatible(appId: string) {
  const entry = appCatalog.entries.find((e) => e.release.appId === appId)
  const module = applicationModules.find((m) => m.manifest.id === appId)
  return entry?.release.runtime.type !== 'shell' || !entry.installation?.version || !!(module && shellVersionCompatible(entry.installation.version, module.manifest.version, module.shellCompatibility?.minimumVersion))
}
let stopViewport: (() => void) | undefined
const isWebHost = !window.Capacitor?.isNativePlatform?.()
function focusWorkspace() {
  document.getElementById('workspace')?.focus()
}
watch(
  () => identity.user?.id,
  (id) => {
    stopChat()
    closeApplicationWindow()
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
  if (!identity.token && localApplications.releases.length && (!location.hash || location.hash === '#')) {
    navigateTab('applications')
  }
  void initializeWechatLogin()
  stopViewport = observeViewport()
})
onBeforeUnmount(() => {
  stopCatalogSync()
  stopNativeRuntime()
  stopChat()
  stopViewport?.()
})
</script>

<template>
  <DeviceConsentDialog />
  <NativeDownloadDialog />
  <MemoryConfirmationDialog v-if="identity.user" />
  <aside
    v-if="localApplications.error"
    class="offline-banner"
    role="alert"
  >{{ localApplications.error }}</aside>
  <aside
    v-if="!online"
    class="offline-banner"
    role="status"
  >当前离线，本地计算可继续使用。云端数据、AI 和支付需要联网。</aside>
  <div
    class="super-app"
    :class="{ 'super-app--detail': !showPrimaryNavigation }"
  >
    <aside class="workspace-rail" aria-label="工作区导航">
      <a
        class="workspace-brand"
        href="#/"
        aria-label="T方舟首页"
      ><span class="workspace-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>T方舟</span></a>
      <nav aria-label="桌面主要导航">
        <button
          v-for="tab in primaryTabs"
          :key="tab.id"
          class="workspace-rail-tab"
          :class="{ active: tab.id === 'home' ? navigation.screen === 'home' : navigation.screen === 'applications' }"
          :aria-current="(tab.id === 'home' ? navigation.screen === 'home' : navigation.screen === 'applications') ? 'page' : undefined"
          @click="navigateTab(tab.id)"
        ><AppIcon :name="tab.icon" :size="22" /><span>{{ tab.id === 'home' ? 'AI 对话' : '应用桌面' }}</span></button>
        <button
          v-if="isWebHost"
          class="workspace-rail-tab"
          @click="openPromotionShare"
        ><AppIcon name="share" :size="22" /><span>分享方舟</span></button>
      </nav>
      <button
        class="workspace-rail-profile"
        :aria-label="identity.user ? '打开账号设置' : '微信登录'"
        @click="identity.user ? openProfile() : showWechatLogin()"
      ><UserAvatar :src="identity.user?.avatarUrl" :size="36" /><span>{{ identity.user?.nickname || '登录' }}</span></button>
    </aside>
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
        v-if="identity.user"
        v-show="navigation.screen === 'home'"
        :active="navigation.screen === 'home'"
      />
      <section v-if="loginRequired && navigation.screen !== 'application'" class="login-required">
        <ApplicationHeader
          v-if="!showPrimaryNavigation"
          :title="currentApplication?.name || '登录'"
          back-label="OS"
          @back="navigateTab('applications')"
        />
        <LoginGate :title="loginPrompt.title" :description="loginPrompt.description" />
      </section>
      <div v-if="!identity.user && navigation.screen === 'applications'" class="guest-mode-notice">
        <span>本地工具，直接使用</span>
        <button class="button button-secondary" @click="openDevicePermissions">设备权限</button>
        <button class="button button-secondary" @click="showWechatLogin">微信登录</button>
      </div>
      <ShortcutsPage v-if="navigation.screen === 'shortcuts'" />
      <PaymentHandoffPage v-if="navigation.screen === 'paymentHandoff'" :key="navigation.revision" />
      <DevicePermissionsPage v-if="navigation.screen === 'devicePermissions'" />
      <ApplicationsPage v-show="navigation.screen === 'applications'" />
      <ApplicationCapabilitiesPage
        v-if="
          identity.user && navigation.screen === 'capabilities' && navigation.capabilityAppId
        "
        :app-id="navigation.capabilityAppId"
      />
      <WalletPage v-if="identity.user && navigation.screen === 'wallet'" />
      <RechargePage v-if="identity.user && navigation.screen === 'recharge'" />
      <PricingPage v-if="identity.user && navigation.screen === 'pricing'" />
      <ResourcesPage v-if="identity.user && navigation.screen === 'resources'" />
      <MemoryPage v-if="identity.user && navigation.screen === 'memory'" :key="identity.user.id" />
      <AccountSettingsPage v-if="identity.user && navigation.screen === 'account'" />
      <ApplicationSurface
        v-if="navigation.screen === 'application' && navigation.application"
        :destination="navigation.application"
        :open-revision="navigation.revision"
      />
    </main>
    <nav
      v-if="showPrimaryNavigation"
      class="bottom-navigation"
      :class="{ 'bottom-navigation--share': isWebHost }"
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
        <button v-if="isWebHost" @click="openPromotionShare"><AppIcon name="share" :size="21" /><span>分享</span></button>
      </div>
    </nav>
    <Teleport to="body">
      <ApplicationWindow
        v-if="navigation.screen === 'home' && navigation.applicationPresentation === 'window' && navigation.application && currentApplication"
        :application="currentApplication"
        @close="closeApplicationWindow"
      >
        <ApplicationSurface
          :destination="navigation.application"
          :open-revision="navigation.revision"
          embedded
        />
      </ApplicationWindow>
    </Teleport>
    <ReminderHost />
    <LoginPage />
    <PromotionShareDialog v-if="isWebHost" />
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
.guest-mode-notice {
  position: absolute;
  z-index: 2;
  top: max(12px, env(safe-area-inset-top));
  right: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #fff;
}
.guest-mode-notice .button {
  padding: 5px 12px;
  min-height: 30px;
}
.login-required {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
@media (max-width: 600px) {
  .guest-mode-notice > span {
    display: none;
  }
}
</style>
