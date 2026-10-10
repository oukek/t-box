import type { Actor } from '@t-box/app-server-sdk'
import type { Resource } from '@t-box/shared'

export type ImageOperation = ((
  value: unknown,
  edit?: boolean,
) => Promise<{ resources: Resource[] }>) & {
  prepare(value: unknown, edit?: boolean): Promise<unknown>
}
export interface ImageToolPort {
  forRun(actor: Actor, signal: AbortSignal, taskId?: string): ImageOperation
}
