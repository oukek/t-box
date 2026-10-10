export type CalculatorKind =
  | "basic"
  | "scientific"
  | "fraction"
  | "statistics"
  | "radix"
  | "quadratic"
  | "linear"
  | "matrix"
  | "vector"
  | "complex"
  | "combination"
  | "sequence"
  | "geometry"
  | "polynomial"
  | "number_theory"
  | "probability";
export interface CalculatorOption {
  value: string;
  label: string;
}
export interface CalculatorField {
  key: string;
  label: string;
  type: "number" | "text" | "date" | "select" | "textarea";
  default: string;
  options?: readonly CalculatorOption[];
  visible?: { field: string; values: readonly string[] };
  placeholder?: string;
}
export interface CalculatorDefinition {
  id: CalculatorKind;
  title: string;
  group: string;
  description: string;
  note: string;
  fields: readonly CalculatorField[];
}
export interface CalculationInput {
  kind: CalculatorKind;
  values: Record<string, string | null>;
}
export interface CalculationResult {
  kind: CalculatorKind;
  title: string;
  items: { label: string; value: string; unit?: string }[];
  note: string;
}
export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationError";
  }
}
export function numeric(
  value: string | null | undefined,
  label: string,
  min = -1e15,
  max = 1e15,
  integer = false,
): number {
  if (
    typeof value !== "string" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  )
    throw new CalculationError(`${label}请输入有效数字`);
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < min ||
    n > max ||
    (integer && !Number.isSafeInteger(n))
  )
    throw new CalculationError(
      `${label}需为${integer ? "整数，" : ""}范围 ${min} 至 ${max} 内的数字`,
    );
  return n;
}
export function formatNumber(n: number): string {
  if (!Number.isFinite(n))
    throw new CalculationError("结果超出可计算范围，或公式在实数范围内无定义");
  return Object.is(n, -0) || n === 0 ? "0" : String(Number(n.toPrecision(15)));
}
export function fieldVisible(
  field: CalculatorField,
  values: Record<string, string | null>,
): boolean {
  return (
    !field.visible ||
    field.visible.values.includes(values[field.visible.field] ?? "")
  );
}
