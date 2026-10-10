export * from './backend.js'
export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export * from './contracts.js'
export * from './remote-tools.js'
export * from './schema.js'
export type {
  BackendInvocation,
  LifecycleReceipt,
  LifecycleRequest,
} from '@t-box/app-contracts'
