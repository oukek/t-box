import type { MarketEntry } from '@t-box/app-contracts'
import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { ResourceRef } from '@t-box/shared'
import { createCalculatorShellModule } from '@t-box/calculator-shell'
import { calendarModule } from '@t-box/calendar-web'
import { ledgerModule } from '@t-box/ledger-web'
import { marketModule } from '@t-box/market-web'
import { profileModule } from '@t-box/settings-web'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/shared'
import { timeModule } from '@t-box/time-web'
import { defineAsyncComponent, shallowReactive } from 'vue'

const calculatorModule = createCalculatorShellModule(
  () => import('../core/app-runtime/WebApplication.vue'),
)
/** Static first-party composition. Neither model output nor database config can import code. */
export const applicationModules = shallowReactive<ClientApplicationModule[]>([
  ledgerModule,
  calculatorModule,
  calendarModule,
  timeModule,
  profileModule,
  marketModule,
])
const ids = new Set<string>()
const actions = new Set<string>()
for (const module of applicationModules) {
  if (module.contractVersion !== APPLICATION_CONTRACT_VERSION) {
    throw new Error(`应用 ${module.manifest.id} 的协议版本不兼容`)
  }
  if (ids.has(module.manifest.id)) {
    throw new Error(`重复应用 ${module.manifest.id}`)
  }
  ids.add(module.manifest.id)
  const ai = module.ai
  if (!ai) {
    continue
  }
  const declared = new Set(ai.interactions.map((item) => item.name))
  if (
    declared.size !== ai.interactions.length ||
    Object.keys(ai.clientTools).some((name) => !declared.has(name)) ||
    ai.interactions.some((item) => !Object.hasOwn(ai.clientTools, item.name))
  ) {
    throw new Error(`应用 ${module.manifest.id} 的前端交互声明与处理器不一致`)
  }
  for (const name of Object.keys(ai.clientTools)) {
    if (actions.has(name) || name === 'app_open') {
      throw new Error(`重复客户端工具 ${name}`)
    }
    actions.add(name)
  }
}
export const clientApplicationTools = Object.assign(
  Object.create(null),
  ...applicationModules.map((module) => module.ai?.clientTools || {}),
) as Record<string, (args: unknown) => Promise<unknown>>
export function cancelClientInteractions() {
  for (const module of applicationModules) {
    module.ai?.cancelInteractions()
  }
}
export function currentScopeBindings() {
  return applicationModules.flatMap((module) => module.ai?.bindings() || [])
}
export async function authorizeResources(
  refs: readonly Readonly<ResourceRef>[],
  purpose: string,
) {
  for (const ref of refs) {
    const module = applicationModules.find(
      (module) => module.manifest.id === ref.appId,
    )
    if (!module?.ai) {
      throw new Error('资源所属应用暂不可用')
    }
    if (!(await module.ai.authorize(ref, purpose))) {
      return false
    }
  }
  return true
}

/** The catalog may introduce vetted web containers, never dynamically import remote Vue/JS into the shell. */
export function syncCatalogModules(entries: readonly MarketEntry[]) {
  for (const entry of entries) {
    const release = entry.release
    if (
      release.runtime.type !== 'web' ||
      applicationModules.some((m) => m.manifest.id === release.appId)
    ) {
      continue
    }
    applicationModules.push({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      manifest: release.manifest,
      navigation: 'shell',
      installation: { kind: release.kind },
      component: defineAsyncComponent(
        () => import('../core/app-runtime/WebApplication.vue'),
      ),
      parseParams(value) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length > 20
        ) {
          throw new Error('应用导航参数无效')
        }
        const params = value as Record<string, unknown>
        if (
          Object.entries(params).some(
            ([k, v]) =>
              !/^\w{1,40}$/.test(k) ||
              typeof v !== 'string' ||
              v.length > 2000,
          )
        ) {
          throw new Error('应用导航参数无效')
        }
        return params as Record<string, string>
      },
      props: (params, context) => ({
        appId: release.appId,
        params,
        openRevision: context.openRevision,
      }),
      ...(release.manifest.skillIds.length
        ? {
            ai: {
              clientTools: {},
              interactions: [],
              bindings: () => [],
              authorize: async () => false,
              cancelInteractions() {},
            },
          }
        : {}),
    })
  }
}
