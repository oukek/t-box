import type { CalculationResult } from './types.js'
import {
  CalculationError,
  formatNumber as f,
  numeric,
} from './types.js'

export function numberList(
  source: string | null | undefined,
  max = 1000,
): number[] {
  if (typeof source !== 'string' || source.length > 16000) {
    throw new CalculationError('数字列表为空或过长')
  }
  const parts = source.trim().split(/[\s,，;；]+/)
  if (!source.trim() || parts.length > max) {
    throw new CalculationError(`请输入 1 至 ${max} 个数字`)
  }
  return parts.map((p) => numeric(p, '列表元素'))
}
export function complexText(a: number, b: number): string {
  return b === 0
    ? f(a)
    : `${a === 0 ? '' : `${f(a)} ${b < 0 ? '−' : '+'} `}${a === 0 && b < 0 ? '−' : ''}${f(Math.abs(b))}i`
}
export function calculateAlgebra(
  kind: string,
  v: Record<string, string | null>,
): CalculationResult['items'] | undefined {
  const n = (key: string) => numeric(v[key], key)
  const item = (label: string, value: number) => ({ label, value: f(value) })
  if (kind === 'quadratic') {
    const a = n('a')
    const b = n('b')
    const c = n('c')
    if (a === 0) {
      return b === 0
        ? [{ label: '解集', value: c === 0 ? '所有实数' : '无解' }]
        : [item('x', -c / b)]
    }
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
    const aa = a / scale
    const bb = b / scale
    const cc = c / scale
    const disc = bb * bb - 4 * aa * cc
    if (disc < 0) {
      const real = -bb / (2 * aa)
      const imag = Math.sqrt(-disc) / (2 * Math.abs(aa))
      return [
        { label: 'x₁', value: complexText(real, imag) },
        { label: 'x₂', value: complexText(real, -imag) },
      ]
    }
    const q = -0.5 * (bb + (bb < 0 ? -1 : 1) * Math.sqrt(disc))
    const x1 = q / aa
    const x2 = q === 0 ? 0 : cc / q
    return [
      item('x₁', x1),
      item('x₂', x2),
      item('判别式 Δ', b * b - 4 * a * c),
    ]
  }
  if (kind === 'linear') {
    const a = n('a1')
    const b = n('b1')
    const c = n('c1')
    const d = n('a2')
    const e = n('b2')
    const g = n('c2')
    const det = a * e - b * d
    const scale = Math.max(Math.abs(a * e), Math.abs(b * d))
    if (det === 0) {
      return [
        {
          label: '解集',
          value:
            a * g === d * c &&
            b * g === e * c &&
            !(a === 0 && b === 0 && c !== 0) &&
            !(d === 0 && e === 0 && g !== 0)
              ? '无穷多解'
              : '无解',
        },
      ]
    }
    if (Math.abs(det) <= scale * 1e-12) {
      throw new CalculationError('系数矩阵接近奇异，无法可靠求解')
    }
    return [item('x', (c * e - b * g) / det), item('y', (a * g - c * d) / det)]
  }
  if (kind === 'complex') {
    const a = n('a')
    const b = n('b')
    const c = n('c')
    const d = n('d')
    let real: number
    let imag: number
    if (v.operation === 'add') {
      real = a + c
      imag = b + d
    } else if (v.operation === 'subtract') {
      real = a - c
      imag = b - d
    } else if (v.operation === 'multiply') {
      real = a * c - b * d
      imag = a * d + b * c
    } else if (v.operation === 'divide') {
      const den = c * c + d * d
      if (den === 0) {
        throw new CalculationError('不能除以零复数')
      }
      real = (a * c + b * d) / den
      imag = (b * c - a * d) / den
    } else {
      throw new CalculationError('复数运算方式无效')
    }
    const angle = Math.atan2(imag, real)
    return [
      { label: '计算结果', value: complexText(real, imag) },
      item('模', Math.hypot(real, imag)),
      { label: '共轭', value: complexText(real, -imag) },
      ...(real === 0 && imag === 0
        ? [{ label: '辐角', value: '零复数无定义' }]
        : [
            { label: '辐角 / rad', value: f(angle) },
            { label: '辐角 / °', value: f((angle * 180) / Math.PI) },
          ]),
    ]
  }
  if (kind === 'vector') {
    const a = numberList(v.a, 20)
    const b = numberList(v.b, 20)
    if (a.length !== b.length) {
      throw new CalculationError('两个向量的维度需一致')
    }
    const dot = a.reduce((s, x, i) => s + x * b[i]!, 0)
    const an = Math.hypot(...a)
    const bn = Math.hypot(...b)
    const display = (ns: number[]) => `(${ns.map(f).join(', ')})`
    return [
      { label: 'A + B', value: display(a.map((x, i) => x + b[i]!)) },
      { label: 'A − B', value: display(a.map((x, i) => x - b[i]!)) },
      item('点积 A · B', dot),
      item('|A|', an),
      item('|B|', bn),
      item('距离 |A − B|', Math.hypot(...a.map((x, i) => x - b[i]!))),
      ...(an && bn
        ? [
            {
              label: '夹角',
              value: f(
                (Math.acos(Math.max(-1, Math.min(1, dot / an / bn))) * 180) /
                Math.PI,
              ),
              unit: '°',
            },
          ]
        : [{ label: '夹角', value: '零向量无定义' }]),
      ...(a.length === 3
        ? [
            {
              label: '叉积 A × B',
              value: display([
                a[1]! * b[2]! - a[2]! * b[1]!,
                a[2]! * b[0]! - a[0]! * b[2]!,
                a[0]! * b[1]! - a[1]! * b[0]!,
              ]),
            },
          ]
        : []),
    ]
  }
  if (kind === 'sequence') {
    const a = n('first')
    const step = n('step')
    const count = numeric(v.n, '项数', 1, 10000, true)
    if (v.type === 'arithmetic') {
      return [
        item('第 n 项', a + (count - 1) * step),
        item('前 n 项和', (count * (2 * a + (count - 1) * step)) / 2),
      ]
    }
    if (v.type !== 'geometric') {
      throw new CalculationError('数列类型无效')
    }
    let sum = 0
    let term = a
    for (let i = 0; i < count; i++) {
      sum += term
      if (i < count - 1) {
        term *= step
      }
    }
    return [item('第 n 项', term), item('前 n 项和', sum)]
  }
  if (kind === 'polynomial') {
    const coefficients = numberList(v.coefficients, 51)
    const x = n('x')
    const lower = n('lower')
    const upper = n('upper')
    let value = coefficients[0]!
    let derivative = 0
    for (const coefficient of coefficients.slice(1)) {
      derivative = derivative * x + value
      value = value * x + coefficient
    }
    const primitive = (at: number) =>
      coefficients.reduce(
        (acc, c, i) => acc * at + c / (coefficients.length - i),
        0,
      ) * at
    return [
      item('P(x)', value),
      item('P′(x)', derivative),
      item('定积分', primitive(upper) - primitive(lower)),
    ]
  }
}
