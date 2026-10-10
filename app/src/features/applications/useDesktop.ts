import type { DesktopApplication, DesktopDevice, DesktopLayout, DesktopSnapshot } from '@t-box/shared'
import {
  systemApplicationManifests,
} from '@t-box/shared'
import { onScopeDispose, reactive, ref, watch } from 'vue'
import { request, RequestError } from '../../core/network'
import { identity } from '../../core/session'

/** Desktop preferences are account/device data. Writes are serialized, with revision fencing. */
export function useDesktop() {
  const defaults = (): DesktopApplication[] =>
    systemApplicationManifests.map((manifest) => ({
      manifest,
      installation: { kind: 'system', uninstallable: false },
      aiAvailable: manifest.skillIds.length > 0,
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
  let controller = new AbortController()
  let desired: string[] | undefined
  let pumping = false
  const load = async () => {
    const generation = epoch
    state.loading = true
    state.error = ''
    try {
      const result = await request<{ data: DesktopSnapshot }>(
        `/desktop/${device.value}`,
        { signal: controller.signal },
      )
      if (generation !== epoch) {
        return
      }
      Object.assign(state, result.data, { ready: true })
    } catch (cause) {
      if (generation === epoch && !controller.signal.aborted) {
        state.error = cause instanceof Error ? cause.message : '桌面读取失败'
      }
    } finally {
      if (generation === epoch) {
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
        void load()
      }
    },
    { immediate: true },
  )
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
    desired = [...ids]
    state.appIds = [...ids]
    void save()
  }
  const retry = () => (desired ? void save() : void load())
  onScopeDispose(() => {
    epoch++
    controller.abort()
    query.removeEventListener('change', onResize)
    window.removeEventListener('tbox:applications-changed', changed)
  })
  return { state, device, reorder, retry }
}
