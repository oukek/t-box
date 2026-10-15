import type { Actor } from '@t-box/app-server-sdk'
import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Shared DB fingerprints cover publishing and lifecycle writes from any API/worker process. */
export class ApplicationCatalogMonitor {
  private readonly subscribers = new Set<{ actor: Actor, revision?: string, changed(revision: string): void, revoked(): void }>()
  private pending?: Promise<void>
  constructor(readonly source: DataSource) {}

  subscribe(actor: Actor, changed: (revision: string) => void, revoked: () => void) {
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
    const sessions = [...new Set(subscribers.map((entry) => entry.actor.sessionHash))]
    const marks = (values: string[]) => values.map(() => '?').join(',')
    const [published, installations, valid] = await Promise.all([
      this.source.query('SELECT r.app_id,r.release_id,r.definition_hash,a.kind FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id WHERE r.published=1 ORDER BY r.app_id'),
      this.source.query(`SELECT user_id,app_id,release_id,target_release_id,generation,status,operation_id,grants,error FROM application_installations WHERE user_id IN (${marks(users)}) ORDER BY user_id,app_id`, users),
      this.source.query(`SELECT s.token_hash FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash IN (${marks(sessions)}) AND s.expires_at>UTC_TIMESTAMP(3) AND u.enabled=TRUE`, sessions),
    ])
    const live = new Set(valid.map((row: { token_hash: string }) => row.token_hash))
    const publication = digest(published)
    const revisions = new Map(users.map((user) => [user, digest([publication, installations.filter((row: { user_id: string }) => row.user_id === user)])]))
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
