import type { CalculatorKind } from '@t-box/shared'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApplicationError } from '@t-box/app-server-sdk'
import { createCalculatorModule, registerCalculator } from '@t-box/calculator-server'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  calculate,
  CalculationError,
  calculatorCatalog,
  calculatorDefaults,
  evaluateExpression,
  parseCalculatorParams,
} from '@t-box/shared'
import Fastify from 'fastify'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { adaptApplication } from '../src/bootstrap/application-adapter.js'

const run = (
  kind: CalculatorKind,
  values: Record<string, string | null> = {},
) => calculate({ kind, values: { ...calculatorDefaults(kind), ...values } })
const value = (
  kind: CalculatorKind,
  values: Record<string, string | null>,
  label: string,
) => run(kind, values).items.find((item) => item.label === label)!.value
const near = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * tolerance,
    `${actual} != ${expected}`,
  )

test('mathematical grammar: precedence, angle modes, functions and bounded errors', () => {
  for (const [formula, expected] of [
    ['2+3*4', 14],
    ['-2^2', -4],
    ['2^3^2', 512],
    ['2^-3', 0.125],
    ['2(3+4)', 14],
    ['sin(30)', 0.5],
    ['asin(0.5)', 30],
    ['log(100)+ln(e)', 3],
    ['5!+ncr(5,2)+npr(5,2)', 150],
    ['gcd(48,18)+lcm(4,6)', 18],
    ['200*10%', 20],
    ['200+10%', 200.1],
    ['max(2,3,1)+hypot(3,4)', 8],
    ['10 mod 3', 1],
    ['0.1+0.2', 0.3],
  ] as const) {
    near(evaluateExpression(formula), expected)
  }
  near(evaluateExpression('sin(pi/2)', 'rad'), 1)
  near(evaluateExpression('ANS*2', 'deg', 7), 14)
  for (const bad of [
    '1/0',
    'sqrt(-1)',
    'tan(90)',
    '171!',
    'ln(0)',
    '2+',
    'alert(1)',
    'constructor(1)',
    'globalThis.process',
    '1e999',
    '2 3',
    '('.repeat(70) + '1' + ')'.repeat(70),
  ]) {
    assert.throws(() => evaluateExpression(bad), CalculationError, bad)
  }
  assert.equal(
    value('scientific', { expression: 'ANS/2', ans: '1e100' }, '计算结果'),
    '5e+99',
  )
})
test('every catalog entry is implemented and nonempty; no unrelated business calculators', () => {
  assert.equal(calculatorCatalog.length, 16)
  assert.ok(
    !calculatorCatalog.some((c) => /loan|date|discount|unit/.test(c.id)),
  )
  for (const entry of calculatorCatalog) {
    const result = run(
      entry.id,
      ['basic', 'scientific'].includes(entry.id) ? { expression: '1+2' } : {},
    )
    assert.ok(result.items.length)
    assert.equal(result.kind, entry.id)
  }
  assert.throws(
    () => calculate({ kind: 'scientific', values: { expression: '1+2' } }),
    /请填写/,
  )
  assert.throws(
    () => run('scientific', { expression: '1', unexpected: '1' }),
    /未支持/,
  )
  assert.throws(
    () => run('scientific', { expression: '1', angle: 'other' }),
    /无效/,
  )
})
test('fractions and base conversion use exact arbitrary precision', () => {
  assert.equal(value('fraction', {}, '最简分数'), '1/2')
  assert.equal(
    value('fraction', { a: '-1', b: '-3', c: '1', d: '6' }, '最简分数'),
    '1/2',
  )
  assert.equal(
    value('fraction', { a: '-7', b: '3', c: '0', d: '1' }, '小数'),
    '-2.333333333333…',
  )
  assert.equal(
    value('fraction', { a: '-7', b: '3', c: '0', d: '1' }, '带分数'),
    '-(2 + 1/3)',
  )
  assert.equal(
    value(
      'fraction',
      { a: '9007199254740993', b: '1', c: '1', d: '1' },
      '最简分数',
    ),
    '9007199254740994',
  )
  assert.throws(() => run('fraction', { b: '0' }), /分母/)
  assert.throws(
    () => run('fraction', { operation: 'divide', c: '0' }),
    /零分数/,
  )
  assert.equal(
    value(
      'radix',
      { value: '9007199254740993', from: '10', to: '16' },
      '16 进制结果',
    ),
    '20000000000001',
  )
  assert.equal(
    value('radix', { value: '-FF', from: '16', to: '10' }, '10 进制结果'),
    '-255',
  )
  assert.throws(() => run('radix', { value: '2', from: '2' }), /不属于/)
})
test('stable equations include degenerate systems and conjugate roots', () => {
  assert.equal(value('quadratic', {}, 'x₁'), '2')
  assert.equal(value('quadratic', {}, 'x₂'), '1')
  assert.equal(value('quadratic', { a: '1', b: '0', c: '1' }, 'x₁'), '1i')
  near(
    Number(value('quadratic', { a: '1', b: '-100000000', c: '1' }, 'x₂')),
    1e-8,
    1e-15,
  )
  assert.equal(
    value('quadratic', { a: '0', b: '0', c: '0' }, '解集'),
    '所有实数',
  )
  assert.equal(value('linear', {}, 'x'), '2')
  assert.equal(value('linear', {}, 'y'), '1')
  assert.equal(
    value(
      'linear',
      { a1: '0', b1: '0', c1: '1', a2: '0', b2: '0', c2: '0' },
      '解集',
    ),
    '无解',
  )
})
test('matrix arithmetic, inverse reconstruction and dimension guards', () => {
  assert.equal(value('matrix', {}, '结果矩阵'), '2  4\n6  8')
  assert.equal(
    value('matrix', { operation: 'determinant', b: null }, '行列式'),
    '-2',
  )
  const inverse = value(
    'matrix',
    { operation: 'inverse', b: null },
    '结果矩阵',
  )
  const product = value('matrix', { b: inverse }, '结果矩阵')
  assert.equal(product, '1  0\n0  1')
  assert.equal(
    value(
      'matrix',
      { operation: 'transpose', a: '1 2 3;4 5 6', b: null },
      '结果矩阵',
    ),
    '1  4\n2  5\n3  6',
  )
  assert.throws(
    () => run('matrix', { operation: 'inverse', a: '1 2;2 4' }),
    /奇异/,
  )
  assert.throws(() => run('matrix', { a: '1 2 3;4 5 6' }), /列数/)
  assert.throws(() => run('matrix', { a: '1 2;3' }), /一致/)
})
test('vectors, complex numbers, sequences and geometry', () => {
  assert.equal(value('vector', {}, '叉积 A × B'), '(0, 0, 1)')
  assert.equal(value('vector', {}, '夹角'), '90')
  assert.equal(value('vector', { a: '0,0,0' }, '夹角'), '零向量无定义')
  assert.equal(
    value('complex', { operation: 'multiply' }, '计算结果'),
    '-5 + 10i',
  )
  assert.throws(
    () => run('complex', { operation: 'divide', c: '0', d: '0' }),
    /零复数/,
  )
  assert.equal(value('sequence', {}, '前 n 项和'), '100')
  assert.equal(
    value(
      'sequence',
      { type: 'geometric', first: '2', step: '1', n: '3' },
      '前 n 项和',
    ),
    '6',
  )
  assert.equal(value('geometry', { shape: 'triangle' }, '面积'), '6')
  assert.throws(
    () =>
      run('geometry', {
        shape: 'triangle',
        length: '1',
        width: '2',
        height: '3',
      }),
    /不等式/,
  )
  near(
    Number(value('geometry', { shape: 'sphere', radius: '1' }, '体积')),
    (4 * Math.PI) / 3,
  )
})
test('statistics, polynomial derivative/integral, exact combinatorics and number theory', () => {
  near(Number(value('statistics', {}, '平均值')), 3)
  near(Number(value('statistics', {}, '总体方差')), 2)
  near(Number(value('statistics', {}, '样本方差')), 2.5)
  near(
    Number(
      value(
        'statistics',
        { data: '1000000000000,1000000000001,1000000000002' },
        '总体方差',
      ),
    ),
    2 / 3,
  )
  assert.equal(value('polynomial', {}, 'P(x)'), '2')
  assert.equal(value('polynomial', {}, 'P′(x)'), '4')
  near(Number(value('polynomial', {}, '定积分')), -4 / 3)
  assert.equal(value('combination', {}, '组合 C(n,r)'), '120')
  assert.equal(
    value('combination', { n: '100', r: '50' }, '组合 C(n,r)'),
    '100891344545564193334812497256',
  )
  assert.equal(value('number_theory', {}, 'A 质因数分解'), '2^3 × 3^2 × 5')
  assert.equal(value('number_theory', {}, '最大公约数'), '24')
  assert.equal(value('number_theory', { a: '999983' }, 'A 是否为质数'), '是')
})
test('binomial tails include zero, one and extreme stable probabilities', () => {
  near(Number(value('probability', {}, 'P(X = k)')), 120 / 1024)
  near(Number(value('probability', {}, 'P(X ≤ k)')), 176 / 1024)
  assert.equal(value('probability', { p: '0' }, 'P(X = k)'), '0')
  assert.equal(value('probability', { p: '1' }, 'P(X ≥ k)'), '1')
  near(
    Number(
      value('probability', { n: '10000', k: '10000', p: '0.9999' }, 'P(X = k)'),
    ),
    0.9999 ** 10000,
    1e-8,
  )
  assert.throws(() => run('probability', { k: '11' }), /范围/)
})
test('calculator application tools and navigation match the catalog', async () => {
  const module = createCalculatorModule()
  const registry = new CapabilityRegistry([adaptApplication(module)])
  const catalog = registry.capabilities('calculator')
  assert.equal(
    catalog.tools.filter((t) => t.execution === 'server').length,
    16,
  )
  assert.equal(catalog.tools.filter((t) => t.execution === 'client').length, 1)
  assert.equal(catalog.agents.length, 1)
  const ctx = { signal: new AbortController().signal } as any
  for (const entry of calculatorCatalog) {
    const values = {
      ...calculatorDefaults(entry.id),
      ...(['basic', 'scientific'].includes(entry.id)
        ? { expression: '1+2' }
        : {}),
    }
    assert.deepEqual(
      await module.tools[`calculator_${entry.id}`]!.handler!(values, ctx),
      run(entry.id, values),
    )
  }
  assert.throws(
    () => module.navigation!.parse({ kind: 'loan' }),
    ApplicationError,
  )
  assert.deepEqual(parseCalculatorParams({ expression: '2+3' }), {
    kind: 'scientific',
    expression: '2+3',
  })
  assert.throws(() =>
    parseCalculatorParams({ kind: 'matrix', expression: '2+3' }),
  )
  assert.throws(() => parseCalculatorParams({ url: 'https://example.com' }))
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    module.tools.calculator_basic!.handler!({ expression: '1' }, {
      signal: aborted.signal,
    } as any),
  )
})
test('authenticated REST runs identical logic and returns safe validation errors', async () => {
  const app = Fastify()
  app.setErrorHandler((err, _req, reply) => {
    const error = err as ApiError
    reply
      .code(error.statusCode ?? 500)
      .send({ error: { code: error.code, message: error.message } })
  })
  registerCalculator(app, async (token) => {
    if (token !== 'fixture') {
      throw new ApiError(401, 'UNAUTHORIZED', '请登录')
    }
  })
  try {
    assert.equal(
      (await app.inject({ url: '/api/v1/calculator/types' })).statusCode,
      401,
    )
    const headers = { authorization: 'Bearer fixture' }
    assert.equal(
      (await app.inject({ url: '/api/v1/calculator/types', headers })).json()
        .data.length,
      16,
    )
    const input = {
      kind: 'matrix',
      values: { ...calculatorDefaults('matrix'), operation: 'inverse' },
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/calculator/calculations',
      headers,
      payload: input,
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().data, calculate(input))
    assert.equal(response.headers['cache-control'], 'no-store')
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/calculator/calculations',
      headers,
      payload: {
        kind: 'basic',
        values: { expression: 'process.exit()', angle: 'deg', ans: '0' },
      },
    })
    assert.equal(invalid.statusCode, 400)
    assert.equal(invalid.json().error.code, 'INVALID_CALCULATION')
  } finally {
    await app.close()
  }
})
