import type { Actor } from '@t-box/app-server-sdk'
import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'
import { In } from 'typeorm'
import { ApplicationInstallationEntity } from '../db/records/applications-entities.js'

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Shared DB fingerprints cover publishing and lifecycle writes from any API/worker process. */
export class ApplicationCatalogMonitor {
  private readonly subscribers = new Set<{
    actor: Actor
    revision?: string
    changed(revision: string): void
    revoked(): void
  }>()

  private pending?: Promise<void>
  constructor(readonly source: DataSource) {}

  subscribe(
    actor: Actor,
    changed: (revision: string) => void,
    revoked: () => void,
  ) {
    const subscriber = { actor, changed, revoked }
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  tick(): Promise<void> {
    this.pending ??= this.scan().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async scan() {
    const subscribers = [...this.subscribers]
    if (!subscribers.length) {
      return
    }
    const users = [...new Set(subscribers.map((entry) => entry.actor.user.id))]
    const sessions = [
      ...new Set(subscribers.map((entry) => entry.actor.sessionHash)),
    ]
    const [published, installations, valid] = await Promise.all([
      this.source
        .createQueryBuilder()
        .select('r.app_id,r.release_id,r.definition_hash,a.kind')
        .from('application_releases', 'r')
        .innerJoin('application_registry', 'a', 'a.app_id=r.app_id')
        .where('r.published=1')
        .orderBy('r.app_id', 'ASC')
        .getRawMany(),
      this.source.getRepository(ApplicationInstallationEntity).find({
        select: {
          user_id: true,
          app_id: true,
          release_id: true,
          target_release_id: true,
          generation: true,
          status: true,
          operation_id: true,
          grants: true,
          error: true,
        },
        where: { user_id: In(users) },
        order: { user_id: 'ASC', app_id: 'ASC' },
      }),
      this.source
        .createQueryBuilder()
        .select('s.token_hash', 'token_hash')
        .from('user_sessions', 's')
        .innerJoin('app_users', 'u', 'u.id=s.user_id')
        .where(
          's.token_hash IN (:...p0) AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE',
        )
        .setParameters({ p0: sessions })
        .getRawMany(),
    ])
    const live = new Set(
      valid.map((row: { token_hash: string }) => row.token_hash),
    )
    const publication = digest(published)
    const revisions = new Map(
      users.map((user) => [
        user,
        digest([
          publication,
          installations.filter(
            (row: { user_id: string }) => row.user_id === user,
          ),
        ]),
      ]),
    )
    for (const subscriber of subscribers) {
      if (!this.subscribers.has(subscriber)) {
        continue
      }
      if (!live.has(subscriber.actor.sessionHash)) {
        this.subscribers.delete(subscriber)
        subscriber.revoked()
      } else {
        const revision = revisions.get(subscriber.actor.user.id)!
        if (revision !== subscriber.revision) {
          subscriber.revision = revision
          subscriber.changed(revision)
        }
      }
    }
  }
}
