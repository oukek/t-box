import { ApplicationError } from '@t-box/app-server-sdk'
import { ErrorCode } from './error-codes.js'
import { runCalculation as calculate } from './service.js'
/** Compatibility REST boundary; all calculation implementation belongs to apps/calculator. */
export function runRestCalculation(input: unknown) {
  try {
    return calculate(input)
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw ErrorCode.INVALID_CALCULATION(error.message)
    }
    throw error
  }
}
