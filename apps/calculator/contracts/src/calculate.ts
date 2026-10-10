import { calculatorCatalog, getCalculatorDefinition } from "./catalog.js";
import {
  CalculationError,
  numeric,
  formatNumber,
  fieldVisible,
  type CalculationInput,
  type CalculationResult,
} from "./types.js";
import { evaluateExpression } from "./expression.js";
import { calculateAlgebra } from "./algebra.js";
import { calculateAnalysis } from "./analysis.js";
import { calculateDiscrete } from "./discrete.js";
import { calculateMatrix } from "./matrix.js";
/** One pure domain entry point shared by the UI, REST and application tools. */
export function calculate(input: unknown): CalculationResult {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CalculationError("计算参数必须为对象");
  const request = input as CalculationInput;
  if (
    Object.keys(request).some((k) => !["kind", "values"].includes(k)) ||
    typeof request.kind !== "string"
  )
    throw new CalculationError("计算类型或参数无效");
  const definition = getCalculatorDefinition(request.kind),
    values = request.values;
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new CalculationError("values 必须为参数对象");
  if (
    Object.keys(values).some(
      (k) => !definition.fields.some((field) => field.key === k),
    )
  )
    throw new CalculationError("包含未支持的计算参数");
  for (const field of definition.fields) {
    const value = values[field.key];
    if (value != null && (typeof value !== "string" || value.length > 16000))
      throw new CalculationError(`${field.label}内容无效或过长`);
    if (!fieldVisible(field, values)) continue;
    if (typeof value !== "string" || !value.trim())
      throw new CalculationError(`请填写${field.label}`);
    if (field.options && !field.options.some((o) => o.value === value))
      throw new CalculationError(`${field.label}选项无效`);
  }
  let items: CalculationResult["items"] | undefined;
  if (request.kind === "basic" || request.kind === "scientific") {
    const ans = numeric(
      values.ans,
      "上次结果",
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
    );
    items = [
      {
        label: "计算结果",
        value: formatNumber(
          evaluateExpression(
            values.expression!,
            values.angle as "deg" | "rad",
            ans,
          ),
        ),
      },
    ];
  } else if (request.kind === "matrix") items = calculateMatrix(values);
  else
    items =
      calculateAlgebra(request.kind, values) ??
      calculateAnalysis(request.kind, values) ??
      calculateDiscrete(request.kind, values);
  if (!items) throw new CalculationError("此计算类型尚未实现");
  return {
    kind: definition.id,
    title: definition.title,
    items,
    note: definition.note,
  };
}
export function calculatorDefaults(kind: string): Record<string, string> {
  return Object.fromEntries(
    getCalculatorDefinition(kind).fields.map((f) => [f.key, f.default]),
  );
}
export function calculatorInputSchema(
  kind: string,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    getCalculatorDefinition(kind).fields.map((field) => [
      field.key,
      {
        anyOf: [
          {
            type: "string",
            description: field.label,
            ...(field.options
              ? { enum: field.options.map((o) => o.value) }
              : {}),
            maxLength:
              field.key === "expression"
                ? 2000
                : field.type === "textarea"
                  ? 16000
                  : 2000,
          },
          { type: "null" },
        ],
      },
    ]),
  );
}
export { calculatorCatalog };
