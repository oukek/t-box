import type {
  CalculationInput,
  CalculationResult,
} from '@t-box/calculator-contracts'
import { persistHistory, runtime } from './runtime'

export interface CalculationHistory {
  id: string
  input: CalculationInput
  result: CalculationResult
  time: string
}
const key = (id: string) => `tbox.calculator.history.v1:${id}`
export function loadHistory(id: string): CalculationHistory[] {
  try {
    const value =
      runtime.initialHistory ??
      JSON.parse(localStorage.getItem(key(id)) || '[]')
    if (!Array.isArray(value)) {
      return []
    }
    return value
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.time === 'string' &&
          typeof item.input?.kind === 'string' &&
          item.input?.values &&
          Array.isArray(item.result?.items) &&
          item.result.items.every(
            (x: unknown) =>
              x &&
              typeof x === 'object' &&
              typeof (x as { label?: unknown }).label === 'string' &&
              typeof (x as { value?: unknown }).value === 'string',
          ),
      )
      .slice(0, 20)
  } catch {
    return []
  }
}
export function saveHistory(id: string, history: CalculationHistory[]) {
  runtime.initialHistory = history
  void persistHistory?.(history).catch(() => {})
  try {
    localStorage.setItem(key(id), JSON.stringify(history))
  } catch {
    /* Calculator remains usable without browser storage. */
  }
}
