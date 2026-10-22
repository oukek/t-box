import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ChatProvider } from '../chat/provider.js'
import type { MemoryJobRow } from '../db/records/memory-entities.js'
import type { MemoryService } from './store.js'
import { randomUUID } from 'node:crypto'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { IsNull, LessThanOrEqual, MoreThan } from 'typeorm'
import { publicRunError } from '../chat/errors.js'
import { settingNumber } from '../configuration/defaults.js'
import { ConversationEntity } from '../db/records/conversations-entities.js'
import {
  MemoryEntity,
  MemoryJobEntity,
  MemorySourceEntity,
} from '../db/records/memory-entities.js'
import { ErrorCode } from '../error-codes.js'
import { extractMemories } from './extractor.js'
import { eligibleMemoryMessage, memoryHash, memoryScore } from './policy.js'
import { conversationMessages, memoryNow, unprotected } from './store.js'

export class MemoryWorker {
  private timer?: ReturnType<typeof setInterval>
  private current?: Promise<void>
  private abort?: AbortController
  constructor(
    private readonly memory: MemoryService,
    private readonly provider: ChatProvider,
    private readonly configuration?: {
      snapshot(): Promise<ConfigurationSnapshot>
    },
    private readonly report: (code: string, id: string) => void = () => {},
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 10000)
    this.timer.unref()
    void this.tick()
  }

  async stop() {
    clearInterval(this.timer)
    this.abort?.abort('SERVER_SHUTDOWN')
    await this.current
  }

  async tick() {
    if (this.current) {
      return this.current
    }
    this.current = this.run()
      .catch(() => this.report('MEMORY_WORKER_FAILED', ''))
      .finally(() => {
        this.current = undefined
      })
    return this.current
  }

  async claim(): Promise<MemoryJobRow | null> {
    return this.memory.source.transaction(async (db) => {
      const repository = db.getRepository(MemoryJobEntity)
      const job = await repository.findOne({
        select: {
          id: true,
          userId: true,
          conversationId: true,
          messageId: true,
          contentHash: true,
          epoch: true,
          status: true,
          availableAt: true,
          leaseUntil: true,
          owner: true,
          error: true,
          state: true,
          createdAt: true,
        },
        where: [
          { status: 'queued', availableAt: LessThanOrEqual(memoryNow()) },
          { status: 'processing', leaseUntil: LessThanOrEqual(memoryNow()) },
        ],
        order: { createdAt: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      })
      if (!job) {
        return null
      }
      job.owner = randomUUID()
      job.status = 'processing'
      job.leaseUntil = new Date(Date.now() + 90000).toISOString()
      await repository.update(
        { id: job.id },
        { owner: job.owner, status: job.status, leaseUntil: job.leaseUntil },
      )
      return job
    })
  }

  private async run() {
    const configuration = (await this.configuration?.snapshot()) ?? {
      revision: 0,
      values: {},
    }
    if (configuration.values['ai.memory.enabled'] === false) {
      return
    }
    const job = await this.claim()
    if (!job) {
      return
    }
    const controller = (this.abort = new AbortController())
    const source = this.memory.source
    const save = async () => {
      const changed = await source
        .getRepository(MemoryJobEntity)
        .createQueryBuilder()
        .update()
        .set({
          state: () => ':memoryState',
          leaseUntil: new Date(Date.now() + 90000).toISOString(),
        })
        .where({ id: job.id, status: 'processing', owner: job.owner! })
        .setParameter('memoryState', JSON.stringify(job.state))
        .execute()
      if (!changed.affected) {
        controller.abort('MEMORY_JOB_CANCELLED')
        throw ErrorCode.MEMORY_LEASE_LOST()
      }
    }
    let renewing = false
    const heartbeat = setInterval(() => {
      if (!renewing) {
        renewing = true
        void save()
          .catch(() => controller.abort('MEMORY_LEASE_LOST'))
          .finally(() => {
            renewing = false
          })
      }
    }, 15000)
    try {
      const state = await this.memory.state(source.manager, job.userId)
      const user = await source
        .getRepository(AppUserEntity)
        .findOne({ select: { enabled: true }, where: { id: job.userId } })
      const conversation = await source
        .getRepository(ConversationEntity)
        .findOne({
          select: { state_json: true, resource_refs: true },
          where: { id: job.conversationId, user_id: job.userId },
        })
      const message =
        conversation &&
        conversationMessages(conversation.state_json).find(
          (message) => message.id === job.messageId,
        )
      if (
        !user?.enabled ||
        !state.enabled ||
        !state.autoExtract ||
        state.epoch !== job.epoch ||
        !message ||
        !eligibleMemoryMessage(message) ||
        message.content.length > 8000 ||
        memoryHash(message.content) !== job.contentHash ||
        !unprotected(conversation!.resource_refs)
      ) {
        await source
          .getRepository(MemoryJobEntity)
          .update(
            { id: job.id, owner: job.owner! },
            { status: 'cancelled', state: {}, owner: null, leaseUntil: null },
          )
        return
      }
      const count = await source.getRepository(MemoryEntity).count({
        where: [
          { userId: job.userId, expiresAt: IsNull() },
          { userId: job.userId, expiresAt: MoreThan(memoryNow()) },
        ],
      })
      if (count >= settingNumber(configuration, 'ai.memory.maxItems', 200)) {
        throw ErrorCode.MEMORY_LIMIT()
      }
      job.state.configuration ??= configuration
      const modelId = String(
        job.state.configuration.values['ai.memory.modelId'] ?? 'pool',
      )
      const provider = this.provider.forRun
        ? await this.provider.forRun(
            job.state.modelKey
              ? { configurationKey: job.state.modelKey }
              : modelId !== 'pool'
                ? { modelId }
                : {},
          )
        : this.provider
      if (provider.mode === 'unconfigured') {
        throw ErrorCode.AI_NOT_CONFIGURED()
      }
      if (
        job.state.modelKey &&
        provider.configurationKey !== job.state.modelKey
      ) {
        throw ErrorCode.TASK_MODEL_CHANGED()
      }
      job.state.modelKey ??= provider.configurationKey
      await save()
      const active = await source.getRepository(MemoryEntity).find({
        select: {
          id: true,
          userId: true,
          slot: true,
          label: true,
          content: true,
          kind: true,
          status: true,
          origin: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
        },
        where: { userId: job.userId, status: 'active' },
        take: 200,
      })
      job.state.existing ??= (
        await this.memory.validRows(source.manager, job.userId, active)
      ).rows.sort(
        (a, b) =>
          memoryScore(message.content, b.label, b.content, b.kind) -
          memoryScore(message.content, a.label, a.content, a.kind),
      ).slice(0, 16).map(({ slot, label, kind, content }) => ({
        slot,
        label,
        kind,
        content: content.slice(0, 300),
      }))
      const result = await extractMemories(
        provider,
        job,
        { text: message.content, createdAt: message.createdAt },
        job.state.existing,
        job.state.configuration,
        controller.signal,
        save,
      )
      if (
        (await this.configuration?.snapshot())?.values['ai.memory.enabled'] ===
        false
      ) {
        await source
          .getRepository(MemoryJobEntity)
          .update(
            { id: job.id, owner: job.owner!, status: 'processing' },
            { status: 'cancelled', state: {}, owner: null, leaseUntil: null },
          )
        return
      }
      await source.transaction(async (db) => {
        // Conversation → user memory state → job is the shared lock order with archival/deletion.
        const fresh = await db.getRepository(ConversationEntity).findOne({
          select: { state_json: true, resource_refs: true },
          where: { id: job.conversationId, user_id: job.userId },
          lock: { mode: 'pessimistic_write' },
        })
        const latest = await this.memory.state(db, job.userId, true)
        const owned = await db.getRepository(MemoryJobEntity).findOne({
          select: { status: true, owner: true },
          where: { id: job.id },
          lock: { mode: 'pessimistic_write' },
        })
        const original =
          fresh &&
          conversationMessages(fresh.state_json).find(
            (row) => row.id === job.messageId,
          )
        if (
          !fresh ||
          !original ||
          !eligibleMemoryMessage(original) ||
          memoryHash(original.content) !== job.contentHash ||
          !unprotected(fresh.resource_refs) ||
          latest.epoch !== job.epoch ||
          !latest.enabled ||
          !latest.autoExtract ||
          owned?.owner !== job.owner ||
          owned.status !== 'processing'
        ) {
          return
        }
        for (const item of result) {
          const expiresAt = item.ttlDays
            ? sqlClock(
                new Date(
                  Date.parse(message.createdAt) + item.ttlDays * 86400000,
                ),
              )
            : null
          if (expiresAt && Date.parse(isoTime(expiresAt)) <= Date.now()) {
            continue
          }
          const old = await db.getRepository(MemoryEntity).findOne({
            select: { content: true, updatedAt: true },
            where: { userId: job.userId, slot: item.slot, status: 'active' },
          })
          if (
            old?.content === item.content ||
            (old &&
              Date.parse(isoTime(old.updatedAt)) >
              Date.parse(message.createdAt))
          ) {
            continue
          }
          const candidate = await db.getRepository(MemoryEntity).findOne({
            select: { id: true },
            where: {
              userId: job.userId,
              slot: item.slot,
              status: 'candidate',
            },
          })
          if (candidate) {
            const reference = await db
              .getRepository(MemorySourceEntity)
              .findOne({
                select: { conversationId: true, messageId: true },
                where: { memoryId: candidate.id },
              })
            const previous =
              reference?.conversationId === job.conversationId
                ? fresh
                : reference
                  ? await db.getRepository(ConversationEntity).findOne({
                      select: { state_json: true },
                      where: {
                        id: reference.conversationId,
                        user_id: job.userId,
                      },
                    })
                  : null
            const evidence =
              previous &&
              conversationMessages(previous.state_json).find(
                (row) => row.id === reference?.messageId,
              )
            if (
              evidence &&
              Date.parse(evidence.createdAt) > Date.parse(message.createdAt)
            ) {
              continue
            }
          }
          await this.memory.put(db, job.userId, item, {
            origin: 'extracted',
            status: 'candidate',
            slot: item.slot,
            expiresAt,
            max: settingNumber(
              job.state.configuration,
              'ai.memory.maxItems',
              200,
            ),
            source: {
              conversationId: job.conversationId,
              messageId: job.messageId,
              contentHash: job.contentHash,
              excerpt: message.content.slice(0, 200),
            },
          })
        }
        await db.getRepository(MemoryJobEntity).update(
          { id: job.id, owner: job.owner! },
          {
            status: 'completed',
            state: {},
            error: null,
            owner: null,
            leaseUntil: null,
          },
        )
      })
    } catch (error) {
      if (controller.signal.reason !== 'SERVER_SHUTDOWN') {
        const failure = publicRunError(error)
        await source.getRepository(MemoryJobEntity).update(
          { id: job.id, owner: job.owner!, status: 'processing' },
          {
            status: 'failed',
            error: failure.message,
            owner: null,
            leaseUntil: null,
          },
        )
        this.report(failure.code, job.id)
      }
    } finally {
      clearInterval(heartbeat)
      this.abort = undefined
    }
  }
}
