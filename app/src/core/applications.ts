import type {
  ApplicationDestination,
  ApplicationManifest,
} from '@t-box/shared'
import { computed } from 'vue'
import { applicationModules } from '../applications/registry'
import { isInstalled } from './app-runtime/catalog'

export const applications = computed(() =>
  applicationModules.map((module) => presentApplication(module.manifest)),
)
/** Only compiled system modules may customize shell presentation; release identity stays intact. */
export function presentApplication(
  manifest: ApplicationManifest,
): ApplicationManifest {
  const module = applicationModules.find(
    (module) => module.manifest.id === manifest.id,
  )
  return module?.installation.kind === 'system' && module.presentation
    ? { ...manifest, ...module.presentation }
    : manifest
}
export const aiApplications = computed(() =>
  applicationModules
    .filter((module) => module.ai && isInstalled(module.manifest.id))
    .map((module) => module.manifest),
)
export function getApplication(id: string) {
  return applications.value.find((app) => app.id === id)
}
/** A validated destination cannot select arbitrary URLs, components or executable code. */
export function parseOpenAppArguments(value: unknown): ApplicationDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('打开应用的参数无效')
  }
  const args = value as Record<string, unknown>
  if (Object.keys(args).some((key) => !['appId', 'params'].includes(key))) {
    throw new Error('打开应用包含未支持的参数')
  }
  const module = applicationModules.find(
    (module) => module.manifest.id === args.appId,
  )
  if (!module) {
    throw new Error('暂不支持打开这个应用')
  }
  return {
    appId: module.manifest.id,
    params: module.parseParams(args.params ?? {}),
  }
}
