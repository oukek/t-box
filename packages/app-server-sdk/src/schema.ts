import type { ApplicationToolDefinition } from "@t-box/app-contracts";
import { invalid } from "@t-box/server-foundation/errors";
export type Schema = Record<string, unknown>;
export const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: "null" }],
});
export function definition(
  name: string,
  description: string,
  properties: Record<string, Schema>,
): ApplicationToolDefinition {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}
export function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("arguments", "参数必须为 JSON 对象");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !fields.includes(key)))
    invalid("arguments", "参数包含未知字段");
  return record;
}
