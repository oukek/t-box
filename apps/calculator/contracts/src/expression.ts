import { CalculationErrorCode } from './error-codes.js'
import { formatNumber } from './types.js'

export type AngleMode = 'deg' | 'rad'
interface Token {
  type: 'number' | 'name' | 'op' | 'end'
  text: string
}
const fail = (message: string): never => {
  throw CalculationErrorCode.INVALID_CALCULATION(message)
}
const finite = (n: number) => {
  formatNumber(n)
  return n
}
function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) {
    fail('阶乘只支持 0 至 170 的整数')
  }
  let value = 1
  for (let i = 2; i <= n; i++) {
    value *= i
  }
  return value
}
function gcd(a: number, b: number): number {
  if (![a, b].every(Number.isSafeInteger)) {
    fail('最大公约数和最小公倍数只支持安全整数')
  }
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}
/** Bounded mathematical grammar; never evaluates JavaScript or resolves object properties. */
export function evaluateExpression(
  source: string,
  angle: AngleMode = 'deg',
  ans = 0,
): number {
  if (typeof source !== 'string' || source.length > 2000 || !source.trim()) {
    fail('请输入公式（最多 2000 个字符）')
  }
  if (angle !== 'deg' && angle !== 'rad') {
    fail('角度模式必须为 deg 或 rad')
  }
  finite(ans)
  const input = source
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/\*\*/g, '^')
  const tokens: Token[] = []
  for (let i = 0; i < input.length;) {
    if (/\s/.test(input[i]!)) {
      i++
      continue
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(
      input.slice(i),
    )
    const name = /^[a-z]+/i.exec(input.slice(i))
    if (number) {
      tokens.push({ type: 'number', text: number[0] })
      i += number[0].length
    } else if (name) {
      const text = name[0].toLowerCase()
      tokens.push({ type: text === 'mod' ? 'op' : 'name', text })
      i += name[0].length
    } else if ('+-*/^!%(),'.includes(input[i]!)) {
      tokens.push({ type: 'op', text: input[i++]! })
    } else {
      fail(`不支持的字符：${input[i]}`)
    }
    if (tokens.length > 512) {
      fail('公式过长，请拆分计算')
    }
  }
  tokens.push({ type: 'end', text: '' })
  let cursor = 0
  let depth = 0
  const peek = () => tokens[cursor]!
  const take = (text: string) =>
    peek().text === text ? (cursor++, true) : false
  const required = (text: string) => {
    if (!take(text)) {
      fail(`此处需要 ${text}`)
    }
  }
  const radians = (n: number) => (angle === 'deg' ? (n * Math.PI) / 180 : n)
  const inverse = (n: number) => (angle === 'deg' ? (n * 180) / Math.PI : n)
  function fn(name: string, args: number[]): number {
    const unary: Record<string, (n: number) => number> = {
      sin: (n) => Math.sin(radians(n)),
      cos: (n) => Math.cos(radians(n)),
      tan: (n) => {
        if (Math.abs(Math.cos(radians(n))) < 1e-14) {
          fail('此角度的正切无定义')
        }
        return Math.tan(radians(n))
      },
      asin: (n) => inverse(Math.asin(n)),
      acos: (n) => inverse(Math.acos(n)),
      atan: (n) => inverse(Math.atan(n)),
      sinh: Math.sinh,
      cosh: Math.cosh,
      tanh: Math.tanh,
      sqrt: Math.sqrt,
      cbrt: Math.cbrt,
      ln: Math.log,
      log: Math.log10,
      log2: Math.log2,
      exp: Math.exp,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sign: Math.sign,
      fact: factorial,
    }
    if (Object.hasOwn(unary, name)) {
      if (args.length !== 1) {
        fail(`${name} 需要 1 个参数`)
      }
      return finite(unary[name]!(args[0]!))
    }
    if (['min', 'max', 'hypot'].includes(name)) {
      if (!args.length || args.length > 32) {
        fail(`${name} 需要 1 至 32 个参数`)
      }
      return finite(
        name === 'min'
          ? Math.min(...args)
          : name === 'max'
            ? Math.max(...args)
            : Math.hypot(...args),
      )
    }
    if (args.length !== 2) {
      fail(`${name} 需要 2 个参数`)
    }
    const [a, b] = args as [number, number]
    if (name === 'pow') {
      return finite(a ** b)
    }
    if (name === 'gcd') {
      return gcd(a, b)
    }
    if (name === 'lcm') {
      const g = gcd(a, b)
      const value = g === 0 ? 0 : Math.abs((a / g) * b)
      if (!Number.isSafeInteger(value)) {
        fail('最小公倍数超出安全整数范围')
      }
      return value
    }
    if (name === 'ncr' || name === 'npr') {
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        a > 170 ||
        b < 0 ||
        b > a
      ) {
        fail('排列组合要求 0 ≤ r ≤ n ≤ 170，且为整数')
      }
      const k = name === 'ncr' ? Math.min(b, a - b) : b
      let v = 1
      for (let i = 1; i <= k; i++) {
        v *= name === 'ncr' ? (a - k + i) / i : a - i + 1
      }
      return finite(v)
    }
    return fail(`不支持的函数：${name}`)
  }
  function atom(): number {
    if (++depth > 64) {
      fail('公式嵌套过深')
    }
    let result: number
    const token = peek()
    if (take('(')) {
      result = sum()
      required(')')
    } else if (token.type === 'number') {
      cursor++
      result = finite(Number(token.text))
    } else if (token.type === 'name') {
      cursor++
      if (take('(')) {
        const args: number[] = []
        if (peek().text !== ')') {
          args.push(sum())
          while (take(',')) {
            if (args.length >= 32) {
              fail('函数参数过多')
            }
            args.push(sum())
          }
        }
        required(')')
        result = fn(token.text, args)
      } else if (token.text === 'pi') {
        result = Math.PI
      } else if (token.text === 'e') {
        result = Math.E
      } else if (token.text === 'ans') {
        result = ans
      } else {
        return fail(`未知名称：${token.text}`)
      }
    } else {
      return fail('公式不完整，请检查数字、运算符或括号')
    }
    depth--
    return result
  }
  function postfix(): number {
    let n = atom()
    while (true) {
      if (take('!')) {
        n = factorial(n)
      } else if (take('%')) {
        n /= 100
      } else {
        break
      }
    }
    return n
  }
  function power(): number {
    let n = postfix()
    if (take('^')) {
      n = finite(n ** unary())
    }
    return n
  }
  function unary(): number {
    if (take('+')) {
      return unary()
    }
    if (take('-')) {
      return -unary()
    }
    return power()
  }
  function product(): number {
    let n = unary()
    while (true) {
      if (take('*')) {
        n = finite(n * unary())
      } else if (take('/')) {
        const d = unary()
        if (d === 0) {
          fail('除数不能为 0')
        }
        n = finite(n / d)
      } else if (take('mod')) {
        const d = unary()
        if (d === 0) {
          fail('余数运算的除数不能为 0')
        }
        n = finite(n % d)
      } else if (peek().text === '(' || peek().type === 'name') {
        n = finite(n * unary())
      } else {
        break
      }
    }
    return n
  }
  function sum(): number {
    let n = product()
    while (true) {
      if (take('+')) {
        n = finite(n + product())
      } else if (take('-')) {
        n = finite(n - product())
      } else {
        break
      }
    }
    return n
  }
  const result = sum()
  if (peek().type !== 'end') {
    fail('公式格式不正确，请检查括号和运算符')
  }
  return finite(result)
}
