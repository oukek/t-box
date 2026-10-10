import type { CalculationResult } from '@t-box/calculator-contracts'
import { ApplicationError } from '@t-box/app-server-sdk'
import {
  calculate,
  CalculationError,
} from '@t-box/calculator-contracts'

export function runCalculation(input: unknown): CalculationResult {
  try {
    return calculate(input)
  } catch (error) {
    if (error instanceof CalculationError) {
      throw new ApplicationError('INVALID_CALCULATION', error.message)
    }
    throw error
  }
}
