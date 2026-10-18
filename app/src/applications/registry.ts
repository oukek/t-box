import type { MarketEntry } from '@t-box/app-contracts'
import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { ResourceRef } from '@t-box/shared'
import { createCalculatorShellModule } from '@t-box/calculator-shell'
import { createCalendarShellModule } from '@t-box/calendar-shell'
import { createLedgerShellModule } from '@t-box/ledger-shell'
import { marketModule } from '@t-box/market-web'
import { profileModule } from '@t-box/settings-web'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/shared'
import { createTimeShellModule } from '@t-box/time-shell'
import { defineAsyncComponent, shallowReactive } from 'vue'
import {
  cancelApplicationInteractions,
  invokeDeclaredApplicationTool,
} from '../core/app-runtime/bridge'
import {
  getApplicationBindings,
  setApplicationBindings,
} from '../core/app-runtime/resourceBindings'
import { openApplication } from '../core/navigation'
import { ErrorCode } from '../error-codes.js'

const calculatorModule = createCalculatorShellModule(
  () => import('../core/app-runtime/WebApplication.vue'),
)
const ledgerModule = createLedgerShellModule(
  () => import('../core/app-runtime/WebApplication.vue'),
  {
    invoke: (tool, args) =>
      invokeDeclaredApplicationTool('ledger', tool, args, openApplication),
    bindings: () => getApplicationBindings('ledger'),
    setBindings: (value) => setApplicationBindings('ledger', value),
    cancel: () => cancelApplicationInteractions('ledger'),
  },
)
const calendarModule = createCalendarShellModule(
  () => import('../core/app-runtime/WebApplication.vue'),
  {
    invoke: (tool, args) =>
      invokeDeclaredApplicationTool('calendar', tool, args, openApplication),
    cancel: () => cancelApplicationInteractions('calendar'),
  },
)
const timeModule = createTimeShellModule(
  () => import('../core/app-runtime/WebApplication.vue'),
  {
    invoke: (tool, args) =>
      invokeDeclaredApplicationTool('time', tool, args, openApplication),
    cancel: () => cancelApplicationInteractions('time'),
  },
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
    throw ErrorCode.INTERNAL_UNSUPPORTED_APPLICATION_PROTOCOL(
      `应用 ${module.manifest.id} 的协议版本不兼容`,
    )
  }
  if (ids.has(module.manifest.id)) {
    throw ErrorCode.INTERNAL_DUPLICATE_APPLICATION(
      `重复应用 ${module.manifest.id}`,
    )
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
    throw ErrorCode.INTERNAL_INVALID_FRONTEND_INTERACTION_CONTRACT(
      `应用 ${module.manifest.id} 的前端交互声明与处理器不一致`,
    )
  }
  for (const name of Object.keys(ai.clientTools)) {
    if (actions.has(name) || name === 'app_open') {
      throw ErrorCode.INTERNAL_DUPLICATE_CLIENT_TOOL(`重复客户端工具 ${name}`)
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
      throw ErrorCode.INTERNAL_RESOURCE_APPLICATION_UNAVAILABLE()
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
          throw ErrorCode.INTERNAL_INVALID_APPLICATION_NAVIGATION()
        }
        const params = value as Record<string, unknown>
        if (
          Object.entries(params).some(
            ([k, v]) =>
              !/^\w{1,40}$/.test(k) || typeof v !== 'string' || v.length > 2000,
          )
        ) {
          throw ErrorCode.INTERNAL_INVALID_APPLICATION_NAVIGATION()
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
