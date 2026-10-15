import type { ApplicationFileContent } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type { ApplicationPlatform } from '../application-platform/service.js'
import type { ResourceService } from './service.js'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from '@t-box/server-foundation/validation'

/** Installation-scoped grants, independent of an application's business resources. */
export class ApplicationFiles {
  constructor(
    readonly applications: ApplicationPlatform,
    readonly resources: ResourceService,
  ) {}

  private async context(actor: Actor, appId: string) {
    if (!validId(appId)) {
      throw new ApiError(400, 'INVALID_APP_ID', '应用标识无效')
    }
    const { installation } = await this.applications.assertActive(
      actor.user.id,
      appId,
    )
    if (!installation.grants.includes('files')) {
      throw new ApiError(
        403,
        'APP_PERMISSION_REQUIRED',
        '此应用没有文件访问权限',
      )
    }
    return installation.generation
  }

  async upload(actor: Actor, appId: string, name: string, bytes: Buffer) {
    const generation = await this.context(actor, appId)
    const file = await this.resources.create(
      actor,
      name,
      bytes,
      'uploaded',
      true,
    )
    if ((await this.context(actor, appId)) !== generation) {
      throw new ApiError(
        409,
        'APP_RUNTIME_EXPIRED',
        '应用安装状态已改变，请重新打开',
      )
    }
    await this.resources.source.query(
      'INSERT INTO application_file_grants(user_id,app_id,generation,resource_id) VALUES(?,?,?,?)',
      [actor.user.id, appId, generation, file.id],
    )
    return file
  }

  async read(
    actor: Actor,
    appId: string,
    resourceId: string,
  ): Promise<ApplicationFileContent> {
    const generation = await this.context(actor, appId)
    const [grant] = await this.resources.source.query(
      'SELECT resource_id FROM application_file_grants WHERE user_id=? AND app_id=? AND generation=? AND resource_id=?',
      [actor.user.id, appId, generation, parseId(resourceId)],
    )
    if (!grant) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在或未授权此应用访问')
    }
    const { resource, bytes } = await this.resources.bytes(actor, resourceId)
    if ((await this.context(actor, appId)) !== generation) {
      throw new ApiError(
        409,
        'APP_RUNTIME_EXPIRED',
        '应用安装状态已改变，请重新打开',
      )
    }
    return { file: resource, base64: bytes.toString('base64') }
  }
}
