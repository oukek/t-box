import type { ApplicationUpdateInfo, MarketEntry } from '@t-box/app-contracts'
import { ErrorCode } from '../../error-codes.js'

export function availableUpdate(
  entry: MarketEntry | undefined,
): ApplicationUpdateInfo | null {
  const installed = entry?.installation
  if (
    !entry ||
    !installed ||
    installed.status !== 'active' ||
    installed.operationId ||
    installed.targetReleaseId ||
    installed.releaseId === entry.release.releaseId
  ) {
    return null
  }
  return {
    appId: entry.release.appId,
    name: entry.release.manifest.name,
    installedVersion: installed.version || installed.releaseId,
    version: entry.release.manifest.version,
    releaseId: entry.release.releaseId,
    releaseNotes: entry.releaseNotes || '',
    prompt: entry.installedUpdatePrompt || { mode: 'default' },
  }
}
export interface UpdatePromptEvent {
  promptId: string
  update: ApplicationUpdateInfo | null
}
/** App-bound acknowledgement with a deadline; missing or broken custom UI falls back. */
export class UpdatePromptRegistry {
  private handlers = new Map<
    string,
    {
      owner: object
      registrationId: string
      emit(event: UpdatePromptEvent): void
    }
  >()

  private displayed = new Map<string, string>()
  private pending = new Map<
    string,
    {
      id: string
      update: ApplicationUpdateInfo
      sent: boolean
      finish(shown: boolean): void
    }
  >()

  constructor(private readonly timeoutMs = 2000) {}

  register(
    appId: string,
    owner: object,
    registrationId: string,
    emit: (event: UpdatePromptEvent) => void,
  ) {
    const previous = this.handlers.get(appId)
    if (previous && previous.owner !== owner) {
      throw ErrorCode.INTERNAL_UPDATE_PROMPT_ALREADY_HANDLED()
    }
    if (previous) {
      this.cancel(appId)
    }
    this.handlers.set(appId, { owner, registrationId, emit })
    this.deliver(appId)
  }

  unregister(appId: string, owner: object, registrationId?: string) {
    const handler = this.handlers.get(appId)
    if (
      handler?.owner !== owner ||
      (registrationId && registrationId !== handler.registrationId)
    ) {
      return
    }
    this.cancel(appId)
    this.handlers.delete(appId)
  }

  request(update: ApplicationUpdateInfo): Promise<boolean> {
    this.cancel(update.appId)
    if (update.prompt.mode !== 'custom') {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      let timer: ReturnType<typeof setTimeout>
      const finish = (shown: boolean) => {
        if (this.pending.get(update.appId)?.id !== id) {
          return
        }
        clearTimeout(timer)
        this.pending.delete(update.appId)
        // Abort a late handler so it cannot open custom UI on top of the fallback.
        if (shown) {
          this.displayed.set(update.appId, id)
        } else {
          this.emitCancelled(update.appId, id)
        }
        resolve(shown)
      }
      timer = setTimeout(finish, this.timeoutMs, false)
      this.pending.set(update.appId, { id, update, sent: false, finish })
      this.deliver(update.appId)
    })
  }

  respond(appId: string, owner: object, promptId: string, shown: boolean) {
    const pending = this.pending.get(appId)
    if (
      this.handlers.get(appId)?.owner !== owner ||
      pending?.id !== promptId ||
      !pending.sent
    ) {
      return false
    }
    pending.finish(shown)
    return true
  }

  cancel(appId: string) {
    this.pending.get(appId)?.finish(false)
    const displayed = this.displayed.get(appId)
    this.displayed.delete(appId)
    if (displayed) {
      this.emitCancelled(appId, displayed)
    }
  }

  private emitCancelled(appId: string, promptId: string) {
    try {
      this.handlers.get(appId)?.emit({ promptId, update: null })
    } catch {
      /* A broken app cannot block the host fallback. */
    }
  }

  private deliver(appId: string) {
    const pending = this.pending.get(appId)
    const handler = this.handlers.get(appId)
    if (!pending || !handler || pending.sent) {
      return
    }
    pending.sent = true
    try {
      handler.emit({ promptId: pending.id, update: pending.update })
    } catch {
      pending.finish(false)
    }
  }
}
export const updatePrompts = new UpdatePromptRegistry()
