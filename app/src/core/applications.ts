import type { ApplicationDestination, ApplicationManifest } from '@t-box/shared'
import { presentApplicationIcon } from '@t-box/shared'
import { computed } from 'vue'
import { applicationModules } from '../applications/registry'
import { ErrorCode } from '../error-codes.js'
import { appCatalog, isInstalled } from './app-runtime/catalog'

export const applications = computed(() =>
  applicationModules.map((module) => {
    const entry = appCatalog.entries.find((row) => row.release.appId === module.manifest.id)
    return presentApplication(entry?.installation?.status === 'active' ? (entry.installedRelease ?? entry.release).manifest : module.manifest)
  }),
)
/** Only compiled system modules may customize shell presentation; release identity stays intact. */
export function presentApplication(
  manifest: ApplicationManifest,
): ApplicationManifest {
  const module = applicationModules.find(
    (module) => module.manifest.id === manifest.id,
  )
  manifest = presentApplicationIcon(manifest)
  return module?.installation.kind === 'system' && module.presentation
    ? { ...manifest, ...module.presentation }
    : manifest
}
export const aiApplications = computed(() =>
  applicationModules
    .filter((module) => module.ai && isInstalled(module.manifest.id))
    .map((module) => applications.value.find((app) => app.id === module.manifest.id)!),
)
export function getApplication(id: string) {
  return applications.value.find((app) => app.id === id)
}
/** A validated destination cannot select arbitrary URLs, components or executable code. */
export function parseOpenAppArguments(value: unknown): ApplicationDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.INTERNAL_INVALID_OPEN_APPLICATION_ARGUMENTS()
  }
  const args = value as Record<string, unknown>
  if (Object.keys(args).some((key) => !['appId', 'params'].includes(key))) {
    throw ErrorCode.INTERNAL_UNSUPPORTED_OPEN_APPLICATION_ARGUMENTS()
  }
  const module = applicationModules.find(
    (module) => module.manifest.id === args.appId,
  )
  if (!module) {
    throw ErrorCode.INTERNAL_UNSUPPORTED_APPLICATION()
  }
  return {
    appId: module.manifest.id,
    params: module.parseParams(args.params ?? {}),
  }
}
