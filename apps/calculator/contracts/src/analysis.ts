import type { CalculationResult } from './types.js'
import { numberList } from './algebra.js'
import {
  CalculationError,
  formatNumber as f,
  numeric,
} from './types.js'

export function calculateAnalysis(
  kind: string,
  v: Record<string, string | null>,
): CalculationResult['items'] | undefined {
  const item = (label: string, value: number) => ({ label, value: f(value) })
  if (kind === 'statistics') {
    const data = numberList(v.data)
    const sorted = [...data].sort((a, b) => a - b)
    const count = data.length
    let mean = 0
    let m2 = 0
    let sum = 0
    let correction = 0
    const frequency = new Map<number, number>()
    data.forEach((x, i) => {
      const delta = x - mean
      mean += delta / (i + 1)
      m2 += delta * (x - mean)
      const y = x - correction
      const next = sum + y
      correction = next - sum - y
      sum = next
      frequency.set(x, (frequency.get(x) ?? 0) + 1)
    })
    const middle = Math.floor(count / 2)
    const median =
      count % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2
    const max = Math.max(...frequency.values())
    const modes = [...frequency]
      .filter(([, n]) => n === max)
      .map(([x]) => x)
      .sort((a, b) => a - b)
    return [
      item('数量', count),
      item('合计', sum),
      item('平均值', mean),
      item('中位数', median),
      {
        label: '众数',
        value:
          max === 1
            ? '无众数'
            : modes.slice(0, 20).map(f).join(', ') +
              (modes.length > 20 ? ' …' : ''),
      },
      item('最小值', sorted[0]!),
      item('最大值', sorted[count - 1]!),
      item('极差', sorted[count - 1]! - sorted[0]!),
      item('总体方差', Math.max(0, m2 / count)),
      item('总体标准差', Math.sqrt(Math.max(0, m2 / count))),
      ...(count > 1
        ? [
            item('样本方差', Math.max(0, m2 / (count - 1))),
            item('样本标准差', Math.sqrt(Math.max(0, m2 / (count - 1)))),
          ]
        : []),
    ]
  }
  if (kind === 'probability') {
    const n = numeric(v.n, 'n', 0, 10000, true)
    const k = numeric(v.k, 'k', 0, n, true)
    const p = numeric(v.p, 'p', 0, 1)
    let exact: number
    let cdf: number
    let tail: number
    if (p === 0 || p === 1) {
      const success = p === 1 ? n : 0
      exact = k === success ? 1 : 0
      cdf = success <= k ? 1 : 0
      tail = success >= k ? 1 : 0
    } else {
      const logAdd = (a: number, b: number) =>
        a === -Infinity
          ? b
          : b === -Infinity
            ? a
            : Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)))
      let logValue = n * Math.log1p(-p)
      let logCdf = -Infinity
      let logTail = -Infinity
      let logExact = -Infinity
      for (let i = 0; i <= n; i++) {
        if (i <= k) {
          logCdf = logAdd(logCdf, logValue)
        }
        if (i >= k) {
          logTail = logAdd(logTail, logValue)
        }
        if (i === k) {
          logExact = logValue
        }
        if (i < n) {
          logValue +=
            Math.log(n - i) - Math.log(i + 1) + Math.log(p) - Math.log1p(-p)
        }
      }
      exact = Math.min(1, Math.exp(logExact))
      cdf = Math.min(1, Math.exp(logCdf))
      tail = Math.min(1, Math.exp(logTail))
    }
    return [
      item('P(X = k)', exact),
      item('P(X ≤ k)', cdf),
      item('P(X ≥ k)', tail),
      item('期望 E[X]', n * p),
      item('方差 Var[X]', n * p * (1 - p)),
    ]
  }
  if (kind === 'geometry') {
    const positive = (key: string) =>
      numeric(v[key], key, Number.MIN_VALUE, 1e12)
    if (v.shape === 'circle') {
      const r = positive('radius')
      return [
        item('面积', Math.PI * r * r),
        item('周长', 2 * Math.PI * r),
        item('直径', 2 * r),
      ]
    }
    if (v.shape === 'rectangle') {
      const a = positive('length')
      const b = positive('width')
      return [
        item('面积', a * b),
        item('周长', 2 * (a + b)),
        item('对角线', Math.hypot(a, b)),
      ]
    }
    if (v.shape === 'triangle') {
      const [a, b, c] = [
        positive('length'),
        positive('width'),
        positive('height'),
      ].sort((x, y) => y - x) as [number, number, number]
      if (c <= a - b) {
        throw new CalculationError('三边不满足三角形不等式')
      }
      const area =
        Math.sqrt(
          (a + (b + c)) * (c - (a - b)) * (c + (a - b)) * (a + (b - c)),
        ) / 4
      return [item('面积', area), item('周长', a + b + c)]
    }
    if (v.shape === 'sphere') {
      const r = positive('radius')
      return [
        item('体积', (4 / 3) * Math.PI * r ** 3),
        item('表面积', 4 * Math.PI * r * r),
      ]
    }
    if (v.shape === 'cylinder') {
      const r = positive('radius')
      const h = positive('height')
      return [
        item('体积', Math.PI * r * r * h),
        item('表面积', 2 * Math.PI * r * (r + h)),
        item('侧面积', 2 * Math.PI * r * h),
      ]
    }
    if (v.shape === 'cuboid') {
      const a = positive('length')
      const b = positive('width')
      const c = positive('height')
      return [
        item('体积', a * b * c),
        item('表面积', 2 * (a * b + b * c + a * c)),
        item('空间对角线', Math.hypot(a, b, c)),
      ]
    }
    throw new CalculationError('几何形状无效')
  }
}
