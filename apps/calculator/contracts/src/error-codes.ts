import { CalculationError } from './types.js'

export const CalculationErrorCode = Object.freeze({
  INVALID_CALCULATION: (message = '计算参数无效') =>
    new CalculationError(message),
})
