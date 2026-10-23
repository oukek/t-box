import type { ApplicationManifest } from '@t-box/app-contracts'
import { ConverterErrorCode } from './error-codes.js'
import { applicationIcon } from './icon.js'

export { ConverterErrorCode } from './error-codes.js'
export const conversionCategoryIds = ['length', 'area', 'volume', 'mass', 'temperature', 'temperature-interval', 'duration', 'speed', 'acceleration', 'angle', 'pressure', 'energy', 'power', 'force', 'torque', 'frequency', 'data', 'data-rate', 'density', 'flow', 'fuel', 'current', 'voltage', 'resistance', 'conductance', 'capacitance', 'charge', 'inductance', 'magnetic-flux', 'magnetic-density', 'illuminance', 'luminance', 'dynamic-viscosity', 'kinematic-viscosity', 'ratio'] as const
export type ConversionCategoryId = typeof conversionCategoryIds[number]
export interface ConversionUnit { id: string, name: string, symbol: string, aliases: readonly string[], note?: string, approximate?: boolean }
export interface ConversionCategory { id: ConversionCategoryId, name: string, group: string, description: string, note: string, units: readonly ConversionUnit[], defaults: readonly [string, string] }
export interface ConversionInput { category: string, value: string, from: string, to: string[] }
export interface ConvertedValue { unit: ConversionUnit, value: string, approximate: boolean }
export interface ConversionResult { category: ConversionCategoryId, value: string, from: ConversionUnit, results: ConvertedValue[], note: string, significantDigits: number }
export interface ConverterParams { category?: string, value?: string, from?: string, to?: string }
export const converterManifest = { id: 'converter', name: '单位换算', description: '长度、面积、温度、数据与工程单位换算，支持批量与 AI 工具。', icon: 'exchange', iconAsset: applicationIcon, color: 'blue', version: '1.1.0', skillIds: ['unit-conversion'] } as const satisfies ApplicationManifest
export function parseConverterParams(value: unknown): Record<string, string> {
  if (value == null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('应用打开参数无效')
  }
  const params: Record<string, string> = {}
  for (const [key, input] of Object.entries(value)) {
    if (!['category', 'value', 'from', 'to'].includes(key) || (input !== null && (typeof input !== 'string' || input.length > 120))) {
      throw ConverterErrorCode.CONVERTER_INVALID_INPUT('应用打开参数无效')
    }
    if (typeof input === 'string') {
      params[key] = input
    }
  }
  if (params.category && !(conversionCategoryIds as readonly string[]).includes(params.category)) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('未知的换算类别')
  }
  return params
}
