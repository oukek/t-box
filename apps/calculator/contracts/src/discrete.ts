import { CalculationError, numeric, type CalculationResult } from "./types.js";
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
function integer(value: string | null | undefined, label: string): bigint {
  if (typeof value !== "string" || !/^[-+]?\d{1,256}$/.test(value.trim()))
    throw new CalculationError(`${label}需为最多 256 位的整数`);
  return BigInt(value.trim());
}
function decimal(n: bigint, d: bigint): string {
  const sign = n < 0n ? "-" : "";
  n = n < 0n ? -n : n;
  let result = sign + String(n / d),
    remainder = n % d;
  if (!remainder) return result;
  result += ".";
  for (let i = 0; i < 12 && remainder; i++) {
    remainder *= 10n;
    result += String(remainder / d);
    remainder %= d;
  }
  return result + (remainder ? "…" : "");
}
export function calculateDiscrete(
  kind: string,
  v: Record<string, string | null>,
): CalculationResult["items"] | undefined {
  if (kind === "fraction") {
    const a = integer(v.a, "分子 A"),
      b = integer(v.b, "分母 B"),
      c = integer(v.c, "分子 C"),
      d = integer(v.d, "分母 D");
    if (b === 0n || d === 0n) throw new CalculationError("分母不能为 0");
    let num: bigint, den: bigint;
    if (v.operation === "add") {
      num = a * d + c * b;
      den = b * d;
    } else if (v.operation === "subtract") {
      num = a * d - c * b;
      den = b * d;
    } else if (v.operation === "multiply") {
      num = a * c;
      den = b * d;
    } else if (v.operation === "divide") {
      if (c === 0n) throw new CalculationError("不能除以零分数");
      num = a * d;
      den = b * c;
    } else throw new CalculationError("分数运算无效");
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const divisor = gcd(num, den);
    num /= divisor;
    den /= divisor;
    const absolute = num < 0n ? -num : num,
      whole = absolute / den,
      rem = absolute % den;
    return [
      { label: "最简分数", value: den === 1n ? String(num) : `${num}/${den}` },
      {
        label: "带分数",
        value:
          rem === 0n
            ? String(num / den)
            : num < 0n && whole
              ? `-(${whole} + ${rem}/${den})`
              : `${num < 0n ? "-" : ""}${whole ? `${whole} + ` : ""}${rem}/${den}`,
      },
      { label: "小数", value: decimal(num, den) },
    ];
  }
  if (kind === "radix") {
    const from = numeric(v.from, "原进制", 2, 36, true),
      to = numeric(v.to, "目标进制", 2, 36, true),
      source = v.value?.trim().toLowerCase();
    if (!source || !/^[-+]?[0-9a-z]{1,256}$/.test(source))
      throw new CalculationError("请输入最多 256 位的有效整数，不带进制前缀");
    let result = 0n;
    const negative = source.startsWith("-"),
      digits = source.replace(/^[-+]/, "");
    for (const char of digits) {
      const digit = parseInt(char, 36);
      if (digit >= from)
        throw new CalculationError(
          `数字 ${char.toUpperCase()} 不属于 ${from} 进制`,
        );
      result = result * BigInt(from) + BigInt(digit);
    }
    if (negative) result = -result;
    return [
      { label: `${to} 进制结果`, value: result.toString(to).toUpperCase() },
      { label: "十进制", value: result.toString() },
    ];
  }
  if (kind === "combination") {
    const n = numeric(v.n, "n", 0, 1000, true),
      r = numeric(v.r, "r", 0, n, true);
    let factorial = 1n,
      permutation = 1n,
      combination = 1n;
    for (let i = 2; i <= n; i++) factorial *= BigInt(i);
    for (let i = 0; i < r; i++) permutation *= BigInt(n - i);
    const k = Math.min(r, n - r);
    for (let i = 1; i <= k; i++)
      combination = (combination * BigInt(n - k + i)) / BigInt(i);
    return [
      { label: "组合 C(n,r)", value: String(combination) },
      { label: "排列 P(n,r)", value: String(permutation) },
      { label: "阶乘 n!", value: String(factorial) },
    ];
  }
  if (kind === "number_theory") {
    const a = numeric(v.a, "A", 1, 1e12, true),
      b = numeric(v.b, "B", 1, 1e12, true),
      divisor = gcd(BigInt(a), BigInt(b));
    let remainder = a;
    const factors: { prime: number; power: number }[] = [];
    for (let p = 2; p * p <= remainder; p = p === 2 ? 3 : p + 2) {
      let count = 0;
      while (remainder % p === 0) {
        count++;
        remainder /= p;
      }
      if (count) factors.push({ prime: p, power: count });
    }
    if (remainder > 1) factors.push({ prime: remainder, power: 1 });
    return [
      {
        label: "A 是否为质数",
        value:
          a > 1 && factors.length === 1 && factors[0]!.power === 1
            ? "是"
            : "否",
      },
      {
        label: "A 质因数分解",
        value:
          a === 1
            ? "1 没有质因数"
            : factors
                .map(({ prime, power }) =>
                  power === 1 ? String(prime) : `${prime}^${power}`,
                )
                .join(" × "),
      },
      { label: "最大公约数", value: String(divisor) },
      { label: "最小公倍数", value: String((BigInt(a) / divisor) * BigInt(b)) },
    ];
  }
}
