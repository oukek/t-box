/** App-owned schemas shared by the care tools; no infant business logic enters the AI runner. */
const instant = { type: 'string', description: '真实发生的 UTC 时间，ISO 8601，例如 2026-10-21T00:00:00.000Z；按宝宝时区换算，不能猜测时间' }
const end = { anyOf: [instant, { type: 'null' }] }
const common = { occurredAt: instant, endedAt: end, note: { type: 'string', maxLength: 500 } }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export const careToolRecord = {
  anyOf: [
    object({ ...common, kind: { type: 'string', enum: ['feeding'] }, state: { type: 'string', enum: ['running', 'paused', 'completed'] }, parts: { type: 'array', minItems: 1, maxItems: 100, items: { anyOf: [
      object({ kind: { type: 'string', enum: ['bottle'] }, milk: { type: 'string', enum: ['formula', 'breast_milk'] }, occurredAt: { ...end, description: '本段实际瓶喂时间，null 使用本次开始时间；跨午夜的补充瓶喂应明确填写实际时刻' }, amountMl: { anyOf: [{ type: 'integer', minimum: 1, maximum: 3000 }, { type: 'null' }], description: '实际喝下的毫升数；不知道则填 null，不能用亲喂时长换算' } }),
      object({ kind: { type: 'string', enum: ['nursing'] }, side: { type: 'string', enum: ['left', 'right'] }, startedAt: instant, endedAt: end }),
    ] } } }),
    object({ ...common, kind: { type: 'string', enum: ['sleep'] }, state: { type: 'string', enum: ['running', 'completed'] } }),
    object({ ...common, kind: { type: 'string', enum: ['diaper'] }, state: { type: 'string', enum: ['completed'] }, contents: { type: 'string', enum: ['wet', 'dirty', 'both', 'change'] } }),
  ],
}
