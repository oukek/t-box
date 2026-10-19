import type { ConversionCategory, ConversionResult, ConversionUnit } from '@t-box/converter-contracts'
import type { CategoryDefinition, UnitDefinition } from './definitions.js'
import { ConverterErrorCode } from '@t-box/converter-contracts'
import { Decimal } from 'decimal.js'
import { definitions } from './definitions.js'

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -12, toExpPos: 24 })
const normal = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
const names = (unit: ConversionUnit) => [unit.id, unit.name, unit.symbol, ...unit.aliases].map(normal)
const publicUnit = ({ id, name, symbol, aliases, note, approximate }: UnitDefinition): ConversionUnit => ({ id, name, symbol, aliases, ...(note ? { note } : {}), ...(approximate ? { approximate } : {}) })
export const conversionCatalog: readonly ConversionCategory[] = definitions.map(({ units, ...category }) => ({ ...category, units: units.map(publicUnit) }))

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('请使用已支持的换算参数')
  }
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, limit = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT(`请填写有效的${label}`)
  }
  return value.trim()
}
function category(id: unknown): CategoryDefinition {
  const result = definitions.find((item) => item.id === id)
  if (!result) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('请选择有效的换算类别')
  }
  return result
}
function unit(category: CategoryDefinition, value: string): UnitDefinition {
  const input = normal(value)
  const exact = category.units.filter((entry) => names(entry).includes(input))
  const matching = exact.length ? exact : category.units.filter((entry) => names(entry).some((name) => name.toLowerCase() === input.toLowerCase()))
  if (matching.length !== 1) {
    throw ConverterErrorCode.CONVERTER_UNKNOWN_UNIT(matching.length > 1 ? `“${value}”有多种含义，请使用明确的单位 ID（注意 b/B、美制/英制）` : `“${value}”不属于${category.name}，请先查询支持的单位`)
  }
  return matching[0]!
}
function numeric(input: unknown) {
  const value = text(input, '数值')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,4})?$/i.test(value)) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('请输入十进制数字或科学计数法，不要附带单位或千分位逗号')
  }
  const result = new D(value)
  if (!result.isFinite() || (!result.isZero() && (result.abs().lt('1e-300') || result.abs().gt('1e300'))) || result.precision() > 50) {
    throw ConverterErrorCode.CONVERTER_OUT_OF_RANGE('支持最多 50 位有效数字，非零数值范围为 1e-300 至 1e300')
  }
  return result
}
const toBase = (amount: Decimal, unit: UnitDefinition) => unit.inverse ? new D(unit.scale[0]).div(amount.mul(unit.scale[1])) : amount.plus(unit.offset || 0).mul(unit.scale[0]).div(unit.scale[1])
const fromBase = (amount: Decimal, unit: UnitDefinition) => unit.inverse ? new D(unit.scale[0]).div(amount.mul(unit.scale[1])) : amount.mul(unit.scale[1]).div(unit.scale[0]).minus(unit.offset || 0)

export function convertUnits(value: unknown): ConversionResult {
  const input = object(value, ['category', 'value', 'from', 'to'])
  const definition = category(input.category)
  const source = unit(definition, text(input.from, '原单位'))
  if (!Array.isArray(input.to) || input.to.length < 1 || input.to.length > 40) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('目标单位需要是包含 1 至 40 项的列表')
  }
  const targets = [...new Set(input.to.map((value) => unit(definition, text(value, '目标单位'))))]
  const amount = numeric(input.value)
  if (definition.id === 'fuel' && amount.lte(0)) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('油耗与燃油经济性的数值必须大于 0')
  }
  const base = toBase(amount, source)
  if (definition.id === 'temperature' && base.lt(0)) {
    throw ConverterErrorCode.CONVERTER_OUT_OF_RANGE('温度不能低于绝对零度（0 K / -273.15 °C / -459.67 °F）')
  }
  return {
    category: definition.id,
    value: amount.isZero() ? '0' : amount.toString(),
    from: publicUnit(source),
    results: targets.map((target) => {
      // Identity never incurs a second reciprocal/affine roundtrip.
      const result = source.id === target.id ? amount : fromBase(base, target)
      const rounded = result.toSignificantDigits(20)
      return { unit: publicUnit(target), value: rounded.isZero() ? '0' : rounded.toString(), approximate: !rounded.eq(result) || (source.id !== target.id && Boolean(source.approximate || target.approximate)) }
    }),
    note: definition.note,
    significantDigits: 20,
  }
}

export function batchConvertUnits(value: unknown): ConversionResult[] {
  const input = object(value, ['items'])
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) {
    throw ConverterErrorCode.CONVERTER_INVALID_INPUT('批量换算支持 1 至 30 项')
  }
  return input.items.map((entry, index) => {
    try {
      return convertUnits(entry)
    } catch (error) {
      if (error instanceof Error) {
        throw ConverterErrorCode.CONVERTER_INVALID_INPUT(`第 ${index + 1} 项：${error.message}`)
      }
      throw error
    }
  })
}

export function discoverUnits(value: unknown) {
  const input = object(value, ['category', 'query'])
  const selected = input.category == null ? conversionCatalog : [conversionCatalog.find((item) => item.id === category(input.category).id)!]
  const query = input.query == null ? '' : text(input.query, '搜索词', 80).toLowerCase()
  if (!input.category && !query) {
    return { categories: conversionCatalog.map(({ id, name, group, units }) => ({ id, name, group, unitCount: units.length })), instructions: '指定 category 查询该类别的单位 ID；美制/英制及 b/B 有区别，缺少条件时先确认。' }
  }
  return { categories: selected.flatMap((entry) => {
    const units = query && ![entry.id, entry.name, entry.description].some((name) => name.toLowerCase().includes(query)) ? entry.units.filter((entry) => names(entry).some((name) => name.toLowerCase().includes(normal(query)))) : entry.units
    return units.length ? [{ ...entry, units }] : []
  }) }
}
