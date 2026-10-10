import { ApplicationError } from '@t-box/app-server-sdk'
import { ApiError } from '@t-box/server-foundation/errors'
import { runCalculation as calculate } from './service.js'
/** Compatibility REST boundary; all calculation implementation belongs to apps/calculator. */
export function runRestCalculation(input: unknown) {
  try {
    return calculate(input)
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw new ApiError(400, error.code, error.message)
    }
    throw error
  }
}
