import type { ApplicationPackage, ResourceAdapter, ResourceProgress } from './contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { AppResources } from '@t-box/capacitor-app-resources'
import { ErrorCode } from '../../../error-codes'

/** Native owns durable files and loopback serving; applications never receive filesystem access. */
export class NativeResourceAdapter implements ResourceAdapter {
  async prepare(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void): Promise<'ready'> {
    if ((await AppResources.has(pkg)).ready) {
      return 'ready'
    }
    if (new URL(pkg.entryUrl).origin === 'https://bundled.tbox.invalid') {
      throw ErrorCode.INTERNAL_APPLICATION_RESOURCES_FAILED('内置应用资源不完整，请重新构建或安装原生包')
    }
    if (!navigator.onLine) {
      throw SdkErrorCode.NETWORK_REQUIRED('本机没有完整的应用资源，请联网完成下载后再离线使用')
    }
    const response = await AppResources.manifest({ ...pkg, baseUrl: pkg.entryUrl })
    if (typeof response.content !== 'string' || response.content.length > 1024 * 1024) {
      throw ErrorCode.INTERNAL_APPLICATION_RESOURCES_FAILED('应用资源清单下载失败')
    }
    const manifest = JSON.parse(response.content) as { protocol?: number, appId?: string, digest?: string, files?: Record<string, string> }
    if (manifest.protocol !== 1 || manifest.appId !== pkg.appId || manifest.digest !== pkg.digest || !manifest.files || Array.isArray(manifest.files)) {
      throw ErrorCode.INTERNAL_APPLICATION_RESOURCES_FAILED('应用资源清单无效')
    }
    const listener = await AppResources.addListener('progress', (event) => {
      if (event.appId === pkg.appId && event.digest === pkg.digest) {
        progress?.(event)
      }
    })
    try {
      // The plugin independently hashes filesJson and every file, bounds sizes, and atomically renames staging.
      await AppResources.prepare({ ...pkg, baseUrl: pkg.entryUrl, filesJson: JSON.stringify(manifest.files) })
    } finally {
      await listener.remove()
    }
    return 'ready'
  }

  async open(pkg: ApplicationPackage) {
    const result = await AppResources.open(pkg)
    const url = new URL(result.entryUrl)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || !url.pathname.endsWith(`/${pkg.digest}/`)) {
      throw ErrorCode.INTERNAL_INVALID_APPLICATION_PACKAGE()
    }
    return { entryUrl: url.href, origin: url.origin, source: 'local' as const }
  }

  async remove(pkg: ApplicationPackage) {
    await AppResources.remove(pkg)
  }
}
