import type { ApplicationBridgeError } from '@t-box/app-contracts'
import { SdkErrorCode } from './error-codes.js'

export class AppSdkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AppSdkError'
  }

  /** Transport boundary: preserve a remote code without registering it as a local error. */
  static from(
    error: unknown,
    fallback = SdkErrorCode.REQUEST_FAILED(),
  ): AppSdkError {
    if (error instanceof AppSdkError) {
      return error
    }
    const value = error as Partial<ApplicationBridgeError> | null
    return new AppSdkError(
      typeof value?.code === 'string' ? value.code : fallback.code,
      typeof value?.message === 'string' ? value.message : fallback.message,
      typeof value?.status === 'number' ? value.status : undefined,
    )
  }
}
