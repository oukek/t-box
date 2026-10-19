export interface ConversionPair { category: string, from: string, to: string }
export interface ConversionHistory extends ConversionPair { id: string, value: string, time: string }
export interface ConverterPreferences { favorites: ConversionPair[], history: ConversionHistory[], last: (ConversionPair & { value: string }) | null }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
function pair(value: unknown): value is ConversionPair {
  return object(value) && ['category', 'from', 'to'].every((key) => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 120)
}
function history(value: unknown): value is ConversionHistory {
  return pair(value) && object(value) && typeof value.id === 'string' && value.id.length <= 60 && typeof value.value === 'string' && value.value.length <= 120 && typeof value.time === 'string' && Number.isFinite(Date.parse(value.time))
}
export function readPreferences(value: unknown): ConverterPreferences {
  const input = object(value) ? value : {}
  return {
    favorites: Array.isArray(input.favorites) ? input.favorites.filter(pair).slice(0, 12) : [],
    history: Array.isArray(input.history) ? input.history.filter(history).slice(0, 30) : [],
    last: pair(input.last) && object(input.last) && typeof input.last.value === 'string' && input.last.value.length <= 120 ? { ...input.last, value: input.last.value } : null,
  }
}
export const pairKey = (pair: ConversionPair) => `${pair.category}:${pair.from}:${pair.to}`
