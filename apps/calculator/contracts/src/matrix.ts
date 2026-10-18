import type { CalculationResult } from './types.js'
import { numberList } from './algebra.js'
import { CalculationErrorCode } from './error-codes.js'
import { formatNumber as f } from './types.js'

type Matrix = number[][]
function parse(value: string | null | undefined): Matrix {
  if (typeof value !== 'string') {
    throw CalculationErrorCode.INVALID_CALCULATION('请输入矩阵')
  }
  const rows = value
    .trim()
    .split(/[\n;；]+/)
    .map((row) => numberList(row, 6))
  if (rows.length > 6 || rows.some((row) => row.length !== rows[0]!.length)) {
    throw CalculationErrorCode.INVALID_CALCULATION(
      '矩阵最多 6 × 6，各行元素数量需一致',
    )
  }
  return rows
}
function square(a: Matrix) {
  if (a.length !== a[0]!.length) {
    throw CalculationErrorCode.INVALID_CALCULATION('此运算需要方阵')
  }
}
const text = (a: Matrix) => a.map((row) => row.map(f).join('  ')).join('\n')
export function calculateMatrix(
  v: Record<string, string | null>,
): CalculationResult['items'] {
  const a = parse(v.a)
  const rows = a.length
  const cols = a[0]!.length
  let result: Matrix
  if (v.operation === 'transpose') {
    result = Array.from({ length: cols }, (_, i) => a.map((row) => row[i]!))
  } else if (v.operation === 'inverse' || v.operation === 'determinant') {
    square(a)
    const m = a.map((row, i) => [
      ...row,
      ...Array.from({ length: rows }, (_, j) => (i === j ? 1 : 0)),
    ])
    let det = 1
    const norm = Math.max(...a.flat().map(Math.abs))
    for (let col = 0; col < rows; col++) {
      let pivot = col
      for (let i = col + 1; i < rows; i++) {
        if (Math.abs(m[i]![col]!) > Math.abs(m[pivot]![col]!)) {
          pivot = i
        }
      }
      const p = m[pivot]![col]!
      if (p === 0) {
        if (v.operation === 'determinant') {
          return [{ label: '行列式', value: '0' }]
        }
        throw CalculationErrorCode.INVALID_CALCULATION('矩阵奇异，不存在逆矩阵')
      }
      if (Math.abs(p) < norm * 1e-12) {
        throw CalculationErrorCode.INVALID_CALCULATION(
          '矩阵接近奇异，无法可靠计算',
        )
      }
      if (pivot !== col) {
        ;[m[pivot], m[col]] = [m[col]!, m[pivot]!]
        det = -det
      }
      det *= p
      for (let j = 0; j < rows * 2; j++) {
        m[col]![j]! /= p
      }
      for (let i = 0; i < rows; i++) {
        if (i !== col) {
          const factor = m[i]![col]!
          for (let j = 0; j < rows * 2; j++) {
            m[i]![j]! -= factor * m[col]![j]!
          }
        }
      }
    }
    if (v.operation === 'determinant') {
      return [{ label: '行列式', value: f(det) }]
    }
    result = m.map((row) => row.slice(rows))
  } else {
    const b = parse(v.b)
    if (v.operation === 'multiply') {
      if (cols !== b.length) {
        throw CalculationErrorCode.INVALID_CALCULATION(
          'A 的列数必须等于 B 的行数',
        )
      }
      result = a.map((row) =>
        Array.from({ length: b[0]!.length }, (_, j) =>
          row.reduce((s, x, k) => s + x * b[k]![j]!, 0)),
      )
    } else if (v.operation === 'add' || v.operation === 'subtract') {
      if (rows !== b.length || cols !== b[0]!.length) {
        throw CalculationErrorCode.INVALID_CALCULATION(
          '加减运算的矩阵尺寸需一致',
        )
      }
      result = a.map((row, i) =>
        row.map((x, j) => x + (v.operation === 'add' ? 1 : -1) * b[i]![j]!),
      )
    } else {
      throw CalculationErrorCode.INVALID_CALCULATION('矩阵运算方式无效')
    }
  }
  return [
    { label: '结果矩阵', value: text(result) },
    { label: '结果尺寸', value: `${result.length} × ${result[0]!.length}` },
  ]
}
