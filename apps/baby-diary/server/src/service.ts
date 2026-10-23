import type {
  BackendEventRequest,
  BackendInvocation,
  LifecycleRequest,
} from '@t-box/app-contracts'
import type {
  PrivateMediaPolicy,
  PrivateMediaPort,
} from '@t-box/server-foundation/persistence/private-media'
import type { DataSource } from 'typeorm'
import {
  BabyErrorCode,
  babyScopes,
  id,
  object,
  text,
} from '@t-box/baby-diary-contracts'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { BabyCare } from './care.js'
import { BabyDomain } from './domain.js'
import {
  BabyActorEntity,
  BabyAuditEntity,
  BabyOperationEntity,
} from './entities.js'
import { BabyProfiles } from './profiles.js'
import { BabyProjects } from './projects.js'
import { BabyRecords } from './records.js'
import { BabySharing } from './sharing.js'

export class BabyDiaryService {
  readonly domain: BabyDomain
  readonly mediaPolicy: PrivateMediaPolicy
  async inspect(
    subject: string,
    babyId: string,
    action: string,
    type = 'baby',
  ) {
    if (!['read', 'write'].includes(action)) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    if (type === 'baby') {
      await this.domain.access.check(
        subject,
        babyId,
        action as 'read' | 'write',
      )
      return
    }
    const privateContent = type.startsWith('private-')
    const scope = privateContent ? type.slice(8) : type
    if (!babyScopes.includes(scope as (typeof babyScopes)[number])) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    await this.domain.access.check(
      subject,
      babyId,
      action as 'read' | 'write',
      scope as (typeof babyScopes)[number],
      privateContent ? 'managers' : 'members',
    )
  }

  constructor(
    readonly source: DataSource,
    readonly media: PrivateMediaPort,
  ) {
    this.domain = new BabyDomain(source, media)
    this.mediaPolicy = {
      authorize: async (subject, scope, action, db) => {
        const privateVisibility = scope.type.startsWith('private-')
        const category = privateVisibility ? scope.type.slice(8) : scope.type
        if (!babyScopes.includes(category as (typeof babyScopes)[number])) {
          throw BabyErrorCode.BABY_FORBIDDEN()
        }
        await this.domain.access.check(
          subject,
          id(scope.id),
          action,
          category as (typeof babyScopes)[number],
          privateVisibility ? 'managers' : 'members',
          db,
        )
      },
    }
  }

  private validateLifecycle(request: LifecycleRequest) {
    if (
      request.appId !== 'baby-diary' ||
      !['install', 'update', 'uninstall'].includes(request.action) ||
      !/^[a-f0-9]{64}$/.test(request.subject) ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 1 ||
      typeof request.releaseId !== 'string' ||
      request.releaseId.length > 80 ||
      typeof request.operationId !== 'string' ||
      request.operationId.length > 80
    ) {
      throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
    }
  }

  async lifecycle(request: LifecycleRequest) {
    this.validateLifecycle(request)
    const operationKey = fingerprint(['lifecycle', request.operationId])
    const payloadHash = fingerprint(request)
    const receipt = await this.source.transaction(async (db) => {
      await db
        .getRepository(BabyActorEntity)
        .createQueryBuilder()
        .insert()
        .values({
          subject: request.subject,
          generation: request.generation,
          releaseId: request.releaseId,
          active: request.action !== 'uninstall',
          createdAt: new Date(),
        })
        .orIgnore()
        .execute()
      const current = await db.getRepository(BabyActorEntity).findOneOrFail({
        where: { subject: request.subject },
        lock: { mode: 'pessimistic_write' },
      })
      const prior = await db.getRepository(BabyOperationEntity).findOne({
        select: { payloadHash: true, response: true },
        where: { subject: request.subject, operationKey },
      })
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
        }
        return prior.response as Record<string, unknown>
      }
      if (
        current.generation > request.generation ||
        (current.generation === request.generation &&
          ((!current.active && request.action !== 'uninstall') ||
            (current.releaseId !== request.releaseId &&
              request.action !== 'update'))) ||
              (request.generation > current.generation &&
                request.action !== 'install')
      ) {
        throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
      }
      await db.getRepository(BabyActorEntity).update(
        { subject: request.subject },
        {
          generation: request.generation,
          releaseId: request.releaseId,
          active: request.action !== 'uninstall',
        },
      )
      const response = {
        appId: request.appId,
        generation: request.generation,
        action: request.action,
      }
      await db.getRepository(BabyOperationEntity).save({
        subject: request.subject,
        operationKey,
        payloadHash,
        response,
        createdAt: new Date(),
      })
      return response
    })
    return { status: 'completed' as const, receipt }
  }

  private async assertInvocation(request: {
    appId: string
    subject: string
    releaseId: string
    generation: number
  }) {
    if (request.appId !== 'baby-diary') {
      throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
    }
    const current = await this.source.getRepository(BabyActorEntity).findOne({
      select: { active: true, generation: true, releaseId: true },
      where: { subject: request.subject },
    })
    if (
      !current?.active ||
      current.generation !== request.generation ||
      current.releaseId !== request.releaseId
    ) {
      throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
    }
  }

  backend() {
    return {
      actions: [{ id: 'care_add', version: 1, title: '记录宝宝照护', description: '记录一次喂养、睡眠或其他照护；仍校验宝宝成员权限', inputSchema: { type: 'object' }, effect: 'write' as const, background: true }],
      lifecycle: (request: LifecycleRequest) => this.lifecycle(request),
      operation: async (request: LifecycleRequest) => {
        this.validateLifecycle(request)
        const prior = await this.source
          .getRepository(BabyOperationEntity)
          .findOne({
            select: { payloadHash: true, response: true },
            where: {
              subject: request.subject,
              operationKey: fingerprint(['lifecycle', request.operationId]),
            },
          })
        return prior && prior.payloadHash === fingerprint(request)
          ? {
              status: 'completed' as const,
              receipt: prior.response as Record<string, unknown>,
            }
          : null
      },
      invoke: (request: BackendInvocation, signal?: AbortSignal) => {
        signal?.throwIfAborted()
        return this.invoke(request)
      },
      events: (request: BackendEventRequest) => this.events(request),
    }
  }

  async events(request: BackendEventRequest) {
    await this.assertInvocation(request)
    if (request.channel !== 'babies') {
      throw BabyErrorCode.BABY_INVALID_INPUT('事件通道无效')
    }
    const v = object(request.arguments, ['babyId'])
    const babyId = id(v.babyId)
    const { baby } = await this.domain.access.check(request.subject, babyId)
    const cursor = String(baby.revision)
    return {
      cursor,
      events:
        cursor === request.cursor
          ? []
          : [
              {
                id: `${babyId}:${cursor}`,
                name: 'baby.changed',
                data: { babyId, revision: baby.revision },
              },
            ],
    }
  }

  async invoke(request: BackendInvocation) {
    await this.assertInvocation(request)
    if (request.appId !== 'baby-diary') {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    const subject = request.subject
    const v = request.arguments
    const key = request.invocationId
    const domain = new BabyDomain(this.source, this.media, {
      generation: request.generation,
      releaseId: request.releaseId,
    })
    const profiles = new BabyProfiles(domain)
    const records = new BabyRecords(domain)
    const projects = new BabyProjects(domain)
    const sharing = new BabySharing(domain)
    const care = new BabyCare(domain)
    switch (request.method) {
      case 'care_list':
        return care.list(subject, v)
      case 'care_add':
        return care.add(subject, v, key)
      case 'care_update':
        return care.change(subject, v, key, 'update')
      case 'care_delete':
        return care.change(subject, v, key, 'delete')
      case 'care_restore':
        return care.change(subject, v, key, 'restore')
      case 'babies_list':
        object(v, [])
        return profiles.list(subject)
      case 'babies_get':
        return domain.access.profile(subject, id(object(v, ['babyId']).babyId))
      case 'babies_create':
        return profiles.create(subject, v, key)
      case 'babies_update':
        return profiles.update(subject, v, key)
      case 'babies_archive':
        return profiles.archive(subject, v, key)
      case 'records_list':
        return records.list(subject, v)
      case 'records_add':
        return records.add(subject, v, key)
      case 'records_update':
        return records.update(subject, v, key)
      case 'records_delete':
        return records.remove(subject, v, key)
      case 'records_restore':
        return records.remove(subject, v, key, true)
      case 'growth_get':
        return records.growth(subject, v)
      case 'projects_list':
        return projects.list(subject, v)
      case 'projects_get':
        return projects.get(subject, v)
      case 'projects_create':
        return projects.create(subject, v, key)
      case 'projects_save':
        return projects.save(subject, v, key)
      case 'projects_restore':
        return projects.remove(subject, v, key, true)
      case 'projects_delete':
        return projects.remove(subject, v, key)
      case 'members_list':
        return sharing.members(subject, v)
      case 'members_update':
        return sharing.update(subject, v, key)
      case 'members_remove':
        return sharing.remove(subject, v, key)
      case 'members_transfer':
        return sharing.transfer(subject, v, key)
      case 'invites_list':
        return sharing.invites(subject, v)
      case 'invites_create':
        return sharing.invite(subject, v, key)
      case 'invites_revoke':
        return sharing.revoke(subject, v, key)
      case 'invites_accept':
        return sharing.join(subject, v, key)
      case 'assets_list': {
        const a = object(v, ['babyId', 'scope', 'ids'])
        const babyId = id(a.babyId)
        const scope = text(a.scope, '文件范围', 40)
        if (!Array.isArray(a.ids) || a.ids.length > 100) {
          throw BabyErrorCode.BABY_INVALID_INPUT(
            '每次最多读取 100 个附件的信息',
          )
        }
        await this.mediaPolicy.authorize(
          subject,
          { id: babyId, type: scope },
          'read',
          this.source.manager,
        )
        return this.media.list(
          this.source.manager,
          { type: scope, id: babyId },
          a.ids.map(id),
        )
      }
      case 'audit_list': {
        const babyId = id(object(v, ['babyId']).babyId)
        await domain.access.check(subject, babyId, 'manage')
        return (
          await this.source.getRepository(BabyAuditEntity).find({
            select: {
              id: true,
              actor: true,
              action: true,
              targetId: true,
              createdAt: true,
            },
            where: { babyId },
            order: { createdAt: 'DESC' },
            take: 100,
          })
        ).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
      }
      default:
        throw BabyErrorCode.BABY_INVALID_INPUT('不支持的宝宝日记接口')
    }
  }
}
