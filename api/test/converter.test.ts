import type { ApplicationToolContext } from '@t-box/app-server-sdk'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conversionCategoryIds, parseConverterParams } from '@t-box/converter-contracts'
import { batchConvertUnits, conversionCatalog, convertUnits, discoverUnits } from '@t-box/converter-core'
import { converterBackend, converterRelease, createConverterModule } from '@t-box/converter-server'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { adaptApplication } from '../src/bootstrap/application-adapter.js'

const result = (category: string, value: string, from: string, to: string) => convertUnits({ category, value, from, to: [to] }).results[0]!
const near = (value: string, expected: number) => assert.ok(Math.abs(Number(value) - expected) <= Math.max(1, Math.abs(expected)) * 1e-14, `${value} != ${expected}`)

test('all 35 categories and 314 units have unique IDs, valid defaults and reversible conversion', () => {
  assert.equal(conversionCatalog.length, 35)
  assert.equal(conversionCatalog.reduce((n, category) => n + category.units.length, 0), 314)
  assert.deepEqual(new Set(conversionCatalog.map((c) => c.id)), new Set(conversionCategoryIds))
  for (const category of conversionCatalog) {
    const ids = category.units.map((unit) => unit.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(category.defaults.every((id) => ids.includes(id)))
    const value = category.id === 'temperature' ? '300' : '1.25'
    const base = category.defaults[0]
    const all = convertUnits({ category: category.id, value, from: base, to: ids })
    assert.equal(all.results.length, ids.length)
    for (const item of all.results) {
      near(result(category.id, item.value, item.unit.id, base).value, Number(value))
      assert.equal(result(category.id, value, item.unit.id, item.unit.id).value, value)
      assert.equal('scale' in item.unit, false)
    }
  }
})

test('known metric, imperial, Chinese, astronomy and engineering reference values', () => {
  const cases = [
    ['length', '1', 'in', 'cm', 2.54],
    ['length', '1', 'mi', 'm', 1609.344],
    ['length', '1', 'nmi', 'm', 1852],
    ['length', '1', 'au', 'm', 149597870700],
    ['area', '3', 'mu', 'm2', 2000],
    ['area', '1', 'acre', 'm2', 4046.8564224],
    ['volume', '1', 'us-gal', 'L', 3.785411784],
    ['volume', '1', 'uk-gal', 'L', 4.54609],
    ['volume', '1', 'metric-cup', 'mL', 250],
    ['volume', '1', 'us-cup', 'mL', 236.5882365],
    ['mass', '1', 'lb', 'kg', 0.45359237],
    ['mass', '1', 'jin', 'g', 500],
    ['mass', '1', 'ozt', 'g', 31.1034768],
    ['duration', '1', 'julian-year', 'd', 365.25],
    ['speed', '36', 'km/h', 'm/s', 10],
    ['speed', '1', 'knot', 'm/s', 1852 / 3600],
    ['acceleration', '1', 'g0', 'm/s2', 9.80665],
    ['angle', '180', 'deg', 'rad', Math.PI],
    ['pressure', '1', 'atm', 'Pa', 101325],
    ['energy', '1', 'kWh', 'J', 3600000],
    ['energy', '1', 'cal-th', 'J', 4.184],
    ['power', '1', 'hp', 'W', 745.6998715822702],
    ['power', '1', 'PS', 'W', 735.49875],
    ['force', '1', 'lbf', 'N', 4.4482216152605],
    ['torque', '1', 'lbf-ft', 'Nm', 1.3558179483314],
    ['frequency', '60', 'rpm', 'Hz', 1],
    ['density', '1', 'g/cm3', 'kg/m3', 1000],
    ['flow', '1', 'm3/h', 'L/min', 1000 / 60],
    ['charge', '1', 'Ah', 'C', 3600],
    ['illuminance', '1', 'fc', 'lx', 10.763910416709722],
    ['dynamic-viscosity', '1', 'cP', 'mPa-s', 1],
    ['kinematic-viscosity', '1', 'cSt', 'mm2/s', 1],
    ['ratio', '1', 'percent', 'ppm', 10000],
  ] as const
  for (const [category, value, from, to, expected] of cases) {
    near(result(category, value, from, to).value, expected)
  }
})

test('affine temperature, temperature intervals and absolute zero are distinct', () => {
  assert.deepEqual(result('temperature', '32', 'degF', 'K').value, '273.15')
  assert.equal(result('temperature', '100', 'degC', 'degF').value, '212')
  assert.equal(result('temperature', '-459.67', 'degF', 'K').value, '0')
  assert.equal(result('temperature', '0', 'K', 'degC').value, '-273.15')
  assert.equal(result('temperature-interval', '10', 'delta-C', 'delta-F').value, '18')
  assert.equal(result('temperature-interval', '-10', 'delta-K', 'delta-C').value, '-10')
  assert.throws(() => result('temperature', '-0.00001', 'K', 'degC'), /绝对零度/)
  assert.throws(() => result('temperature', '-273.15001', 'degC', 'degF'), /绝对零度/)
  assert.throws(() => result('temperature', '1', 'delta-C', 'K'), /不属于/)
})

test('SI/IEC and b/B remain distinct; ambiguous case folding is rejected', () => {
  assert.equal(result('data', '1', 'MB', 'B').value, '1000000')
  assert.equal(result('data', '1', 'MiB', 'B').value, '1048576')
  assert.equal(result('data', '1', 'Mb', 'B').value, '125000')
  assert.equal(result('data-rate', '100', 'Mbit/s', 'MB/s').value, '12.5')
  assert.throws(() => result('data', '1', 'mb', 'B'), /多种含义/)
  assert.equal(result('length', '1', '英寸', 'cm').value, '2.54')
  assert.equal(result('length', '1', 'μm', 'm').value, '0.000001')
})

test('fuel economy uses reciprocals, with separate US/UK gallon standards', () => {
  assert.equal(result('fuel', '5', 'L/100km', 'km/L').value, '20')
  near(result('fuel', '1', 'mpg-US', 'L/100km').value, 235.2145833333333)
  near(result('fuel', '1', 'mpg-UK', 'L/100km').value, 282.4809363318222)
  assert.throws(() => result('fuel', '0', 'L/100km', 'mpg-US'), /大于 0/)
  assert.throws(() => result('fuel', '-1', 'mpg-US', 'L/100km'), /大于 0/)
})

test('decimal precision, rounding markers and bounded numeric grammar', () => {
  assert.equal(result('length', '9007199254740993', 'm', 'cm').value, '900719925474099300')
  assert.equal(result('length', '0.1', 'm', 'cm').value, '10')
  assert.equal(result('length', '1.25e3', 'm', 'km').value, '1.25')
  assert.equal(result('length', '-0', 'm', 'cm').value, '0')
  assert.equal(result('area', '1', 'mu', 'm2').approximate, true)
  assert.equal(result('angle', '1', 'rad', 'deg').approximate, true)
  assert.equal(result('length', '1.234567890123456789012', 'm', 'm').approximate, true)
  for (const value of ['NaN', 'Infinity', '1,000', '1+1', '1e9999', '1e-301', '1'.repeat(51), '1'.repeat(121), '']) {
    assert.throws(() => result('length', value, 'm', 'cm'), value)
  }
  assert.equal(result('length', '1e300', 'm', 'm').value, '1e+300')
  assert.equal(result('length', '1e-300', 'm', 'm').value, '1e-300')
})

test('batch bounds, dimension checks and lazy discovery prevent guessing or oversized catalogs', () => {
  const input = { category: 'length', value: '1', from: 'm', to: ['cm', 'cm'] }
  assert.equal(convertUnits(input).results.length, 1)
  assert.deepEqual(batchConvertUnits({ items: [input, { category: 'mass', value: '1', from: 'kg', to: ['g'] }] }).map((r) => r.results[0]!.value), ['100', '1000'])
  for (const invalid of [null, [], { ...input, extra: 'bad' }, { ...input, to: [] }, { ...input, to: Array.from({ length: 41 }).fill('cm') }, { ...input, to: ['kg'] }]) {
    assert.throws(() => convertUnits(invalid))
  }
  assert.throws(() => batchConvertUnits({ items: [] }))
  assert.throws(() => batchConvertUnits({ items: Array.from({ length: 31 }).fill(input) }))
  assert.throws(() => batchConvertUnits({ items: [input, { ...input, to: ['kg'] }] }), /第 2 项/)
  const summaries = discoverUnits({ category: null, query: null })
  assert.equal(summaries.categories.length, 35)
  assert.ok(summaries.categories.every((c) => !('units' in c)))
  const detailed = discoverUnits({ category: 'temperature', query: null })
  assert.equal(detailed.categories.length, 1)
  assert.ok('units' in detailed.categories[0]!)
  assert.equal(discoverUnits({ query: '不存在的单位' }).categories.length, 0)
})

test('AI and app runtime share server-only tools; cancellation and system installation contracts', async () => {
  const module = createConverterModule()
  const context: ApplicationToolContext = { bindings: [], requestId: 'fixture', signal: new AbortController().signal, session: { messages: [] }, interact: async () => {
    assert.fail('Conversion must not require a frontend')
  }, use: async (_key, factory) => factory() }
  const input = { category: 'length', value: '1', from: 'm', to: ['cm'] }
  assert.deepEqual(await module.tools.converter_convert!.handler!(input, context), convertUnits(input))
  // The browser imports core directly; server/AI adapters must preserve identical results.
  for (const category of conversionCatalog) {
    const args = { category: category.id, value: '300', from: category.defaults[0], to: category.units.map((unit) => unit.id) }
    const expected = convertUnits(args)
    assert.deepEqual(await module.tools.converter_convert!.handler!(args, context), expected)
    assert.deepEqual(await converterBackend.invoke!({ appId: 'converter', releaseId: converterRelease.releaseId, generation: 1, subject: 'fixture', invocationId: 'fixture', method: 'convert', arguments: args }), expected)
  }
  const registry = new CapabilityRegistry([adaptApplication(module)])
  assert.equal(registry.capabilities('converter').tools.length, 3)
  for (const tool of Object.values(module.tools)) {
    assert.equal(tool.execution, 'server')
    assert.equal(tool.effect, 'read')
    assert.equal(tool.alwaysAvailable, undefined)
    await assert.rejects(tool.handler!(input, { ...context, signal: AbortSignal.abort() }), /abort/i)
  }
  assert.equal(converterRelease.kind, 'system')
  assert.equal(converterRelease.defaultInstalled, true)
  assert.deepEqual(converterRelease.platforms, ['web', 'android', 'ios'])
  assert.deepEqual(parseConverterParams({ category: 'mass', value: '1', from: 'kg', to: 'g' }), { category: 'mass', value: '1', from: 'kg', to: 'g' })
  assert.throws(() => parseConverterParams({ category: 'currency' }))
  assert.throws(() => parseConverterParams({ url: 'https://external.invalid/' }))
  await assert.rejects(converterBackend.invoke!({ appId: 'converter', releaseId: 'converter-1.0.0', generation: 1, subject: 'fixture', invocationId: 'fixture', method: 'private', arguments: {} }), /方法|接口/)
})
