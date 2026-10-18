import type { AppRelease } from '@t-box/app-contracts'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applicationBootstrapArtifacts,
  applicationSettings,
} from '../config.js'
import { ErrorCode } from '../error-codes.js'
/** Deployment operator configures the artifact origin; model output and user parameters never choose URLs. */
export function resolveWebDeployment(release: AppRelease): AppRelease {
  if (release.runtime.type !== 'web') {
    return release
  }
  const settings = applicationSettings()
  if (settings.delivery === 'oss') {
    const artifact = applicationBootstrapArtifacts()[release.appId]
    const origin = new URL(settings.origin)
    if (
      !artifact ||
      origin.protocol !== 'https:' ||
      origin.origin !== settings.origin
    ) {
      throw ErrorCode.INTERNAL_PRODUCTION_BOOTSTRAP_REQUIRED()
    }
    return {
      ...release,
      releaseId: `${release.appId}-${release.manifest.version}-${createHash(
        'sha256',
      )
        .update(origin.origin + artifact)
        .digest('hex')
        .slice(0, 20)}`,
      runtime: {
        type: 'web',
        entryUrl: `${origin.origin}/${release.appId}/${artifact}/`,
        integrity: `sha256-${artifact}`,
      },
    }
  }
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const path = resolve(root, 'apps', release.appId, 'deployment.local.json')
  if (!existsSync(path)) {
    if (process.env.NODE_ENV === 'production') {
      throw ErrorCode.INTERNAL_PRODUCTION_ARTIFACT_ORIGIN_REQUIRED()
    }
    return release
  }
  const config = JSON.parse(readFileSync(path, 'utf8')) as {
    origin: string
    artifact: string
  }
  const origin = new URL(config.origin)
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.hash ||
    origin.search ||
    !/^[a-f0-9]{64}$/.test(config.artifact)
  ) {
    throw ErrorCode.INTERNAL_INVALID_APPLICATION_DEPLOYMENT_CONFIGURATION()
  }
  const manifest = JSON.parse(
    readFileSync(
      resolve(
        root,
        'output',
        'app-artifacts',
        release.appId,
        config.artifact,
        'artifact.json',
      ),
      'utf8',
    ),
  )
  if (
    manifest.appId !== release.appId ||
    manifest.protocol !== 1 ||
    manifest.digest !== config.artifact ||
    createHash('sha256')
      .update(JSON.stringify(manifest.files))
      .digest('hex') !== config.artifact
  ) {
    throw ErrorCode.INTERNAL_APPLICATION_ARTIFACT_DIGEST_DOES_NOT_MATCH_DEPLOYMENT()
  }
  return {
    ...release,
    releaseId: `${release.appId}-${release.manifest.version}-${createHash(
      'sha256',
    )
      .update(origin.origin + config.artifact)
      .digest('hex')
      .slice(0, 20)}`,
    runtime: {
      type: 'web',
      entryUrl: `${origin.origin}/${release.appId}/${config.artifact}/`,
      integrity: `sha256-${config.artifact}`,
    },
  }
}
