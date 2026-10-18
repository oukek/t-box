import type { ApplicationFileContent } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type { ApplicationPlatform } from '../application-platform/service.js'
import type { ResourceService } from './service.js'
import { validId } from '@t-box/app-contracts'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { parseId } from '@t-box/server-foundation/validation'
import { ApplicationFileGrantEntity, ApplicationInstallationEntity } from '../db/records/applications-entities.js'
import { ErrorCode } from '../error-codes.js'

/** Installation-scoped grants, independent of an application's business resources. */
export class ApplicationFiles {
  constructor(
    readonly applications: ApplicationPlatform,
    readonly resources: ResourceService,
  ) {}

  private async context(actor: Actor, appId: string) {
    if (!validId(appId)) {
      throw ErrorCode.INVALID_APP_ID()
    }
    const { installation } = await this.applications.assertActive(
      actor.user.id,
      appId,
    )
    if (!installation.grants.includes('files')) {
      throw ErrorCode.APP_PERMISSION_REQUIRED.forbidden()
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
    await this.resources.source.transaction(async (db) => {
      // Match application lifecycle lock order: user, then installation. Network
      // upload is already complete, so neither lock spans object storage I/O.
      await db
        .getRepository(AppUserEntity)
        .findOne({
          select: { id: true },
          where: { id: actor.user.id },
          lock: { mode: 'pessimistic_write' },
        })
      const installation = await db
        .getRepository(ApplicationInstallationEntity)
        .findOne({
          select: {
            user_id: true,
            generation: true,
            status: true,
            grants: true,
          },
          where: { user_id: actor.user.id, app_id: appId },
          lock: { mode: 'pessimistic_write' },
        })
      if (
        !installation ||
        installation.status !== 'active' ||
        installation.generation !== generation
      ) {
        throw ErrorCode.APP_RUNTIME_EXPIRED()
      }
      if (
        !Array.isArray(installation.grants) ||
        !installation.grants.includes('files')
      ) {
        throw ErrorCode.APP_PERMISSION_REQUIRED.forbidden()
      }
      await db.getRepository(ApplicationFileGrantEntity).insert({
        user_id: actor.user.id,
        app_id: appId,
        generation,
        resource_id: file.id,
      })
    })
    return file
  }

  async read(
    actor: Actor,
    appId: string,
    resourceId: string,
  ): Promise<ApplicationFileContent> {
    const generation = await this.context(actor, appId)
    const grant = await this.resources.source
      .getRepository(ApplicationFileGrantEntity)
      .findOne({
        select: { resource_id: true },
        where: {
          user_id: actor.user.id,
          app_id: appId,
          generation,
          resource_id: parseId(resourceId),
        },
      })
    if (!grant) {
      throw ErrorCode.FILE_NOT_FOUND()
    }
    const { resource, bytes } = await this.resources.bytes(actor, resourceId)
    if ((await this.context(actor, appId)) !== generation) {
      throw ErrorCode.APP_RUNTIME_EXPIRED()
    }
    return { file: resource, base64: bytes.toString('base64') }
  }
}
