import { configureShellServices, updateShellState } from '@t-box/app-shell-sdk'
import { watchEffect } from 'vue'
import {
  appCatalog,
  changeInstallation,
  refreshCatalog,
} from '../core/app-runtime/catalog'
import { deviceResources } from '../core/app-runtime/resources'
import {
  createHostTransport,
  trustedApplicationRequest,
} from '../core/app-runtime/sdkHost'
import { appInfo } from '../core/appInfo'
import { applicationMutation } from '../core/applicationMutation'
import { presentApplication } from '../core/applications'
import { desktopAppearance, refreshDesktopAppearance, releaseWallpaperPreviews, saveDesktopWallpapers, uploadDesktopWallpaper } from '../core/desktopAppearance'
import { createRequestId } from '../core/identifiers'
import {
  backFromApplication,
  navigation,
  openAccountSettings,
  openApplication,
  openDevicePermissions,
  openProfile,
  openShortcuts,
  tabLabel,
} from '../core/navigation'
import { request } from '../core/network'
import { preferences, setPreference } from '../core/preferences'
import { identity, setSession } from '../core/session'
import { logout, updateAvatar, updateNickname } from '../features/identity/identityApi'

export function initializeApplicationShell() {
  configureShellServices({
    createAppTransport: (appId) =>
      createHostTransport({ appId, trusted: true }),
    applicationRequest: trustedApplicationRequest,
    applicationWrite: (appId, path, method, body) =>
      trustedApplicationRequest(appId, path, {}, { method, body }),
    request,
    applicationMutation,
    createRequestId,
    openApplication,
    backFromApplication,
    tabLabel: (id) => tabLabel(id as Parameters<typeof tabLabel>[0]),
    openAccountSettings,
    openDevicePermissions,
    openShortcuts,
    openProfile,
    setPreference,
    refreshDesktopAppearance,
    saveDesktopWallpapers,
    uploadDesktopWallpaper,
    releaseWallpaperPreviews,
    logout,
    updateNickname,
    updateAvatar,
    refreshCatalog,
    changeInstallation,
    presentApplication,
    invalidateSession: () => setSession(null),
    async changePassword(currentPassword, newPassword) {
      await request('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setSession(null)
    },
  })
  watchEffect(
    () => {
      updateShellState({
        identity: {
          user: identity.user,
          ready: identity.ready,
          error: identity.error,
        },
        navigation: { backTo: navigation.backTo },
        preferences,
        desktopAppearance,
        appInfo,
        appCatalog: { ...appCatalog, resources: { ...deviceResources } },
      })
    },
    { flush: 'sync' },
  )
}
