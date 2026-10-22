import type { DesktopApplication, DesktopDevice, DesktopLayout, DesktopSnapshot } from '@t-box/shared'
import {
  systemApplicationManifests,
} from '@t-box/shared'
import { onScopeDispose, reactive, ref, watch } from 'vue'
import { applicationModules } from '../../applications/registry'
import { appCatalog } from '../../core/app-runtime/catalog'
import { localApplications, localEntries, mergeLocalEntries } from '../../core/app-runtime/localApplications'
import { request, RequestError } from '../../core/network'
import { identity } from '../../core/session'
import { refreshDesktopManifests } from './desktopPresentation'

/** Desktop preferences are account/device data. Writes are serialized, with revision fencing. */
export function useDesktop() {
  const defaults = (): DesktopApplication[] =>
    systemApplicationManifests.map((manifest) => ({
      manifest,
      installation: { kind: applicationModules.find((m) => m.manifest.id === manifest.id)?.installation.kind || 'system', uninstallable: false, status: 'installing', error: null },
      aiAvailable: false,
    }))
  const query = window.matchMedia('(max-width: 700px)')
  const device = ref<DesktopDevice>(query.matches ? 'mobile' : 'pc')
  const onResize = () => {
    device.value = query.matches ? 'mobile' : 'pc'
  }
  query.addEventListener('change', onResize)
  const changed = () => {
    if (identity.user) {
      // eslint-disable-next-line ts/no-use-before-define -- The event listener runs after load is initialized.
      void load()
    }
  }
  window.addEventListener('tbox:applications-changed', changed)
  const state = reactive({
    appIds: systemApplicationManifests.map((m) => m.id),
    applications: defaults(),
    revision: 0,
    catalogRevision: '',
    ready: false,
    loading: false,
    saving: false,
    error: '',
  })
  let epoch = 0
  let loadSequence = 0
  let controller = new AbortController()
  let desired: string[] | undefined
  let pumping = false
  const orderKey = () => `tbox.desktop.local-order.v1.${identity.user?.id}:${device.value}`
  const withLocalTools = (applications: DesktopApplication[]) => {
    for (const entry of localEntries(identity.user?.id, appCatalog.entries)) {
      const index = applications.findIndex((app) => app.manifest.id === entry.release.appId)
      if (index < 0 || applications[index]?.installation.status !== 'active') {
        const local: DesktopApplication = { manifest: entry.release.manifest, installation: { kind: 'system', uninstallable: false, status: 'active', error: null }, aiAvailable: false }
        if (index < 0) {
          applications.push(local)
        } else {
          applications[index] = local
        }
      }
    }
    return applications
  }
  const restoreLocal = () => {
    const applications: DesktopApplication[] = mergeLocalEntries(appCatalog.entries.filter((entry) => entry.installation?.status === 'active'), identity.user?.id).map((entry) => ({
      manifest: (entry.installedRelease ?? entry.release).manifest,
      installation: { kind: entry.release.kind, uninstallable: entry.release.kind === 'user', status: 'active', error: null },
      aiAvailable: false,
    }))
    if (!applications.length) {
      return false
    }
    const ids = applications.map((app) => app.manifest.id)
    let saved: string[] = []
    try {
      const value: unknown = JSON.parse(localStorage.getItem(orderKey()) || '[]')
      if (Array.isArray(value)) {
        saved = value.filter((id): id is string => typeof id === 'string' && ids.includes(id))
      }
    } catch { /* Fall back to installed catalog order. */ }
    state.applications = applications
    state.appIds = [...new Set([...saved, ...ids])]
    state.ready = true
    return true
  }
  const load = async () => {
    const generation = epoch
    const sequence = ++loadSequence
    state.loading = true
    state.error = ''
    try {
      const result = await request<{ data: DesktopSnapshot }>(
        `/desktop/${device.value}`,
        { signal: controller.signal },
      )
      if (generation !== epoch || sequence !== loadSequence) {
        return
      }
      Object.assign(state, result.data, { ready: true })
      state.applications = withLocalTools(state.applications)
      state.appIds = [...new Set([...state.appIds, ...state.applications.map((app) => app.manifest.id)])]
      try {
        localStorage.setItem(orderKey(), JSON.stringify(result.data.appIds))
      } catch { /* Device-local display order is optional. */ }
    } catch (cause) {
      if (generation === epoch && sequence === loadSequence && !controller.signal.aborted) {
        state.error = restoreLocal() ? '' : (cause instanceof Error ? cause.message : '桌面读取失败')
      }
    } finally {
      if (generation === epoch && sequence === loadSequence) {
        state.loading = false
      }
    }
  }
  watch(
    () => `${identity.user?.id}:${device.value}`,
    () => {
      epoch++
      controller.abort()
      controller = new AbortController()
      desired = undefined
      pumping = false
      Object.assign(state, {
        ready: false,
        loading: false,
        saving: false,
        error: '',
        revision: 0,
        catalogRevision: '',
        applications: defaults(),
        appIds: systemApplicationManifests.map((m) => m.id),
      })
      if (identity.user) {
        restoreLocal()
        void load()
      } else if (localApplications.releases.length) {
        restoreLocal()
      }
    },
    { immediate: true },
  )
  watch(() => appCatalog.revision, () => {
    if ((identity.user || localApplications.releases.length) && (!identity.user || !navigator.onLine || !state.ready)) {
      restoreLocal()
    } else if (identity.user) {
      // Socket-driven catalog refreshes also apply artwork immediately on an already mounted desktop.
      state.applications = refreshDesktopManifests(state.applications, appCatalog.entries)
      void load()
    }
  })
  window.addEventListener('online', changed)
  const save = async () => {
    if (pumping || !state.ready || !identity.user) {
      return
    }
    const generation = epoch
    const currentDevice = device.value
    const currentController = controller
    pumping = true
    state.saving = true
    state.error = ''
    // eslint-disable-next-line no-unmodified-loop-condition -- Account/device watchers can change epoch while the request is awaited.
    while (desired && generation === epoch) {
      const target = desired
      desired = undefined
      try {
        const result = await request<{ data: DesktopLayout }>(
          `/desktop/${currentDevice}`,
          {
            method: 'PUT',
            signal: currentController.signal,
            body: JSON.stringify({
              appIds: target,
              revision: state.revision,
              catalogRevision: state.catalogRevision,
            }),
          },
        )
        if (generation !== epoch) {
          return
        }
        state.revision = result.data.revision
        if (!desired) {
          state.appIds = result.data.appIds
        }
      } catch (cause) {
        if (generation !== epoch) {
          return
        }
        if (
          cause instanceof RequestError &&
          ['DESKTOP_LAYOUT_CHANGED', 'DESKTOP_CATALOG_CHANGED'].includes(
            cause.code,
          )
        ) {
          desired = undefined
          await load()
          state.error = '桌面已在其他窗口更新，请重新整理。'
        } else {
          desired ||= target
          if (!currentController.signal.aborted) {
            state.error =
              cause instanceof Error ? cause.message : '排序未保存，请重试'
          }
        }
        break
      }
    }
    if (generation === epoch) {
      pumping = false
      state.saving = false
    }
  }
  const reorder = (ids: readonly string[]) => {
    if (!state.ready || JSON.stringify(ids) === JSON.stringify(state.appIds)) {
      return
    }
    if (!identity.user) {
      state.appIds = [...ids]
      try {
        localStorage.setItem(orderKey(), JSON.stringify(ids))
      } catch { /* Guests retain a usable in-memory layout if storage is denied. */ }
      return
    }
    if (!navigator.onLine || !state.catalogRevision) {
      state.error = '桌面排序需要联网保存，请连接网络后重试'
      state.appIds = [...state.appIds]
      return
    }
    desired = [...ids]
    state.appIds = [...ids]
    void save()
  }
  const retry = () => (desired ? void save() : void load())
  const refreshTimer = setInterval(() => {
    if (navigator.onLine && identity.user && !state.loading && state.applications.some((app) => app.installation.status === 'installing' || (app.installation.kind === 'system' && app.installation.status === 'failed'))) {
      void load()
    }
  }, 10_000)
  onScopeDispose(() => {
    epoch++
    clearInterval(refreshTimer)
    controller.abort()
    query.removeEventListener('change', onResize)
    window.removeEventListener('tbox:applications-changed', changed)
    window.removeEventListener('online', changed)
  })
  return { state, device, reorder, retry }
}
