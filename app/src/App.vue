<script setup lang="ts">
import ReminderHost from '@t-box/device-reminders/ReminderHost.vue'
import AccountSettingsPage from '@t-box/settings-web/pages/AccountSettingsPage.vue'
import { AppIcon, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applicationModules } from './applications/registry'
import ApplicationSurface from './core/app-runtime/ApplicationSurface.vue'
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
  closeAssistant,
  navigateTab,
  navigation,
  openDevicePermissions,
  openProfile,
  startNavigation,
} from './core/navigation'
import { identity } from './core/session'
import { observeViewport } from './core/viewport'
import ApplicationCapabilitiesPage from './features/applications/ApplicationCapabilitiesPage.vue'
import ApplicationsPage from './features/applications/ApplicationsPage.vue'
import AssistantHost from './features/assistant/AssistantHost.vue'
import PaymentHandoffPage from './features/billing/PaymentHandoffPage.vue'
import { recoverNativeCheckout } from './features/billing/pendingCheckout'
import PricingPage from './features/billing/PricingPage.vue'
import RechargePage from './features/billing/RechargePage.vue'
import WalletPage from './features/billing/WalletPage.vue'
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
const assistantFullscreen = ref(false)
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
  (id, previousId) => {
    stopChat()
    if (previousId) {
      closeAssistant()
    }
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
    v-if="localApplications.error && !assistantFullscreen"
    class="offline-banner"
    role="alert"
  >{{ localApplications.error }}</aside>
  <aside
    v-if="!online && !assistantFullscreen"
    class="offline-banner"
    role="status"
  >当前离线，本地计算可继续使用。云端数据、AI 和支付需要联网。</aside>
  <div
    class="super-app"
    :class="{ 'super-app--detail': navigation.screen !== 'applications' }"
    :inert="assistantFullscreen || undefined"
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
      <header v-if="navigation.screen === 'applications'" class="desktop-topbar">
        <a
          class="desktop-brand"
          href="#/"
          @click.prevent="navigateTab('applications')"
        ><span class="desktop-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>T方舟</span></a>
        <div class="desktop-topbar__actions">
          <button
            v-if="!identity.user"
            class="desktop-action"
            aria-label="设备权限"
            @click="openDevicePermissions"
          ><AppIcon name="lock" :size="19" /></button>
          <button
            v-if="isWebHost"
            class="desktop-action"
            aria-label="分享方舟"
            title="分享方舟"
            @click="openPromotionShare"
          ><AppIcon name="share" :size="19" /></button>
          <button
            class="desktop-account"
            :aria-label="identity.user ? '打开账号设置' : '微信登录'"
            @click="identity.user ? openProfile() : showWechatLogin()"
          ><UserAvatar :src="identity.user?.avatarUrl" :size="28" /><span>{{ identity.user?.nickname || '登录' }}</span></button>
        </div>
      </header>
      <section v-if="loginRequired && navigation.screen !== 'application'" class="login-required">
        <ApplicationHeader
          :title="currentApplication?.name || '登录'"
          back-label="桌面"
          @back="navigateTab('applications')"
        />
        <LoginGate :title="loginPrompt.title" :description="loginPrompt.description" />
      </section>
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
  <AssistantHost @fullscreen="assistantFullscreen = $event" />
</template>

<style scoped>
.login-required {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
