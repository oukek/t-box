<script setup lang="ts">
import ReminderHost from '@t-box/device-reminders/ReminderHost.vue'
import AccountSettingsPage from '@t-box/settings-web/pages/AccountSettingsPage.vue'
import { AppIcon, BrandMark, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applicationModules } from './applications/registry'
import AppSwitcher from './components/AppSwitcher.vue'
import ApplicationSurface from './core/app-runtime/ApplicationSurface.vue'
import { closeApplicationRuntimes, prepareApplicationForClose } from './core/app-runtime/bridge'
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
import DevelopmentFallbackNotice from './core/native-runtime/DevelopmentFallbackNotice.vue'
import DeviceConsentDialog from './core/native-runtime/DeviceConsentDialog.vue'
import DevicePermissionsPage from './core/native-runtime/DevicePermissionsPage.vue'
import { startNativeRuntime } from './core/native-runtime/lifecycle'
import NativeDownloadDialog from './core/native-runtime/NativeDownloadDialog.vue'
import ShortcutsPage from './core/native-runtime/ShortcutsPage.vue'
import {
  closeAssistant,
  navigateTab,
  navigation,
  openApplication,
  openDevicePermissions,
  openProfile,
  startNavigation,
} from './core/navigation'
import { isNativeIos } from './core/platform'
import { identity } from './core/session'
import { hasWindowBar, observeViewport } from './core/viewport'
import InstallDesktop from './core/web-release/InstallDesktop.vue'
import WebReleaseDialog from './core/web-release/WebReleaseDialog.vue'
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
import NotificationBell from './features/notifications/NotificationBell.vue'
import NotificationCenter from './features/notifications/NotificationCenter.vue'
import NotificationToast from './features/notifications/NotificationToast.vue'
import { startNotificationSync } from './features/notifications/store'
import PromotionShareDialog from './features/promotions/PromotionShareDialog.vue'
import { openPromotionShare } from './features/promotions/share'
import ResourcesPage from './features/resources/ResourcesPage.vue'

const currentApplication = computed(() =>
  navigation.application
    ? getApplication(navigation.application.appId)
    : undefined,
)
interface AppWindow { destination: NonNullable<typeof navigation.application>, revision: number, expanded: boolean, x: number, y: number }
const windows = ref<AppWindow[]>([])
const activeId = computed(() => navigation.screen === 'application' ? navigation.application?.appId : undefined)
const onDesktop = computed(() => navigation.screen === 'applications' || !!activeId.value)
const activeWindow = computed(() => windows.value.find((item) => item.destination.appId === activeId.value))
watch([activeId, () => navigation.revision, () => identity.user?.id], ([id], previous) => {
  if (previous.length && previous[2] !== identity.user?.id) {
    windows.value = []
  }
  const destination = navigation.application
  if (!id || !destination) {
    return
  }
  const existing = windows.value.find((item) => item.destination.appId === id)
  if (!existing) {
    windows.value.push({ destination, revision: navigation.revision, expanded: false, x: 0, y: 0 })
  } else if ((Object.keys(destination.params ?? {}).length && JSON.stringify(destination.params) !== JSON.stringify(existing.destination.params)) || previous[0] === id) {
    existing.destination = destination
    existing.revision = navigation.revision
  }
}, { immediate: true })
const switcher = ref<InstanceType<typeof AppSwitcher>>()
let drag: { id: number, offsetX: number, offsetY: number } | undefined
function startDrag(event: PointerEvent, item: AppWindow) {
  if (item.expanded || event.button !== 0 || (event.target as Element).closest('button')) {
    return
  }
  const bar = event.currentTarget as HTMLElement
  const rect = bar.parentElement!.getBoundingClientRect()
  drag = { id: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
  bar.setPointerCapture(event.pointerId)
}
function moveWindow(event: PointerEvent, item: AppWindow) {
  if (!drag || drag.id !== event.pointerId || item.expanded) {
    return
  }
  const rect = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
  const freeX = window.innerWidth - rect.width
  const freeY = window.innerHeight - rect.height
  item.x = Math.min(freeX, Math.max(0, event.clientX - drag.offsetX)) - freeX / 2
  item.y = Math.min(freeY, Math.max(0, event.clientY - drag.offsetY)) - freeY / 2
}
const runningApps = computed(() => windows.value.map((item) => ({
  item,
  app: getApplication(item.destination.appId),
})))
watch([() => identity.user?.id, () => navigation.revision], () => {
  switcher.value?.close()
})
function resumeWindow(item: AppWindow) {
  switcher.value?.close()
  if (activeId.value !== item.destination.appId) {
    void openApplication(item.destination)
  }
}
const returning = ref(false)
const returnError = ref('')
watch(() => navigation.revision, () => {
  returnError.value = ''
})
async function closeWindow(id: string) {
  if (returning.value) {
    return
  }
  const revision = navigation.revision
  returning.value = true
  returnError.value = ''
  try {
    await prepareApplicationForClose(id)
    if (navigation.revision === revision) {
      windows.value = windows.value.filter((item) => item.destination.appId !== id)
      if (activeId.value === id) {
        navigateTab('applications')
      }
      if (!windows.value.length) {
        switcher.value?.close()
      }
    }
  } catch {
    if (navigation.revision === revision) {
      returnError.value = '请先在应用内保存或结束编辑，再关闭应用。'
    }
  } finally {
    returning.value = false
  }
}
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
const stopNotifications = startNotificationSync()
function hostCompatible(appId: string) {
  const entry = appCatalog.entries.find((e) => e.release.appId === appId)
  const module = applicationModules.find((m) => m.manifest.id === appId)
  return entry?.release.runtime.type !== 'shell' || !entry.installation?.version || !!(module && shellVersionCompatible(entry.installation.version, module.manifest.version, module.shellCompatibility?.minimumVersion))
}
let stopViewport: (() => void) | undefined
const desktopShell = !!window.__TBOX_DESKTOP_KEY__
const productionWeb = import.meta.env.PROD && !window.__TBOX_DESKTOP_KEY__ && !window.Capacitor?.isNativePlatform?.()
const isWebHost = !window.Capacitor?.isNativePlatform?.()
const assistantPlatform = isNativeIos() ? 'ios' : isWebHost && !window.__TBOX_DESKTOP_KEY__ ? 'web' : undefined
const assistantHidden = computed(() => {
  return assistantPlatform === 'ios' || (assistantPlatform === 'web' && appCatalog.assistantHiddenWeb)
})
watch([assistantHidden, () => navigation.assistantOpen], ([hidden, open]) => {
  if (hidden) {
    assistantFullscreen.value = false
    if (open) {
      closeAssistant()
    }
  }
}, { immediate: true })
function desktopContextMenu(event: MouseEvent) {
  if (navigation.screen !== 'applications' || (!isWebHost && !desktopShell) || (event.target instanceof Element && event.target.closest('dialog'))) {
    return
  }
  event.preventDefault()
  // Touch long-press and the keyboard menu key still enter icon arrangement.
  if (event.button === 2 && (event as PointerEvent).pointerType !== 'touch') {
    event.stopPropagation()
  }
}
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
  stopNotifications()
  stopChat()
  stopViewport?.()
})
</script>

<template>
  <DevelopmentFallbackNotice v-if="navigation.screen === 'applications' && !assistantFullscreen" />
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
        'workspace-plane--desktop': onDesktop,
        'workspace-plane--billing': ['wallet', 'recharge', 'pricing'].includes(
          navigation.screen,
        ),
      }"
      tabindex="-1"
      @contextmenu.capture="desktopContextMenu"
    >
      <header v-if="navigation.screen === 'applications'" class="desktop-topbar">
        <a
          class="desktop-brand"
          href="#/"
          @click.prevent="navigateTab('applications')"
        ><BrandMark class="desktop-brand-mark" /><span>T方舟</span></a>
        <div class="desktop-topbar__actions">
          <InstallDesktop v-if="isWebHost && !desktopShell" />
          <NotificationBell v-if="identity.user" />
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
            :aria-label="identity.user ? '打开账号设置' : '登录'"
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
      <ApplicationsPage v-show="onDesktop" :inert="activeId ? true : undefined" />
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
      <section
        v-for="item in windows"
        v-show="activeId === item.destination.appId"
        :key="item.destination.appId"
        class="app-window"
        :data-window-bar="hasWindowBar ? 'shown' : 'hidden'"
        :class="{ 'expanded': item.expanded, 'native-desktop-window': desktopShell }"
        :style="{ '--offset-x': item.x + 'px', '--offset-y': item.y + 'px' }"
        :aria-label="getApplication(item.destination.appId)?.name"
      >
        <header
          v-if="hasWindowBar"
          class="app-window-bar"
          @pointerdown="startDrag($event, item)"
          @pointermove="moveWindow($event, item)"
          @lostpointercapture="drag = undefined"
          @dblclick="!($event.target as Element).closest('button') && (item.expanded = !item.expanded)"
        >
          <div class="window-controls">
            <button
              class="close"
              title="关闭应用"
              aria-label="关闭应用"
              :disabled="returning"
              @click="closeWindow(item.destination.appId)"
            ><span><AppIcon name="close" :size="10" /></span></button>
            <button
              class="minimize"
              title="最小化到桌面"
              aria-label="最小化到桌面"
              @click="navigateTab('applications')"
            ><span><svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            ><path
              d="M2 5h6"
              stroke="currentColor"
              stroke-width="1.5"
            /></svg></span></button>
            <button
              class="maximize"
              :title="item.expanded ? '还原窗口' : '软件内全屏'"
              :aria-label="item.expanded ? '还原窗口' : '软件内全屏'"
              :aria-pressed="item.expanded"
              @click="item.expanded = !item.expanded"
            ><span><svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            ><path
              d="M2 5V2h3m3 3v3H5M2 2l6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            /></svg></span></button>
          </div>
          <strong>{{ getApplication(item.destination.appId)?.name }}</strong>
          <small v-if="returnError && item === activeWindow" role="alert">{{ returnError }}</small>
        </header>
        <div class="app-window-content"><ApplicationSurface
          :destination="item.destination"
          :open-revision="item.revision"
          :embedded="hasWindowBar"
        /></div>
      </section>
    </main>
    <AppSwitcher v-if="windows.length && onDesktop" ref="switcher">
      <button
        v-if="activeId"
        class="switch-desktop"
        @click="switcher?.close(); navigateTab('applications')"
      ><AppIcon name="apps" :size="17" />收起到桌面</button>
      <div class="running-list">
        <div
          v-for="{ item, app } in runningApps"
          :key="item.destination.appId"
          class="running-row"
        >
          <button class="running-resume" @click="resumeWindow(item)">
            <LauncherIcon
              :icon="app?.icon || 'apps'"
              :icon-variant="app?.iconVariant"
              :icon-asset="app?.iconAsset"
            />
            <span>{{ app?.name || item.destination.appId }}</span>
            <small v-if="activeId === item.destination.appId">当前</small>
          </button>
          <button
            class="running-close"
            :disabled="returning"
            :aria-label="'关闭' + (app?.name || item.destination.appId)"
            @click="closeWindow(item.destination.appId)"
          ><AppIcon name="close" :size="17" /></button>
        </div>
        <small v-if="returnError" role="alert">{{ returnError }}</small>
      </div>
    </AppSwitcher>
    <WebReleaseDialog :enabled="productionWeb" />
    <ReminderHost />
    <NotificationCenter v-if="identity.user" />
    <NotificationToast v-if="identity.user" />
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
  <AssistantHost v-if="(!assistantPlatform || appCatalog.assistantPolicyReady) && !assistantHidden" @fullscreen="assistantFullscreen = $event" />
</template>

<style scoped>
.login-required {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
