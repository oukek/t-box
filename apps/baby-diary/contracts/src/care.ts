import { BabyErrorCode, integer, object, text } from './index.js'

export type CareKind = 'feeding' | 'sleep' | 'diaper'
export type CareState = 'running' | 'paused' | 'completed'
export interface BottlePart {
  kind: 'bottle'
  milk: 'formula' | 'breast_milk'
  amountMl: number | null
  /** Supplementary bottles may occur after midnight within the same feeding. */
  occurredAt?: string
}
export interface NursingPart {
  kind: 'nursing'
  side: 'left' | 'right'
  startedAt: string
  endedAt: string | null
}
export type FeedingPart = BottlePart | NursingPart
interface CareBase {
  occurredAt: string
  endedAt: string | null
  note: string
  state: CareState
}
export type CareInput =
  | (CareBase & { kind: 'feeding', parts: FeedingPart[] }) |
  (CareBase & { kind: 'sleep' }) |
  (CareBase & { kind: 'diaper', contents: 'wet' | 'dirty' | 'both' | 'change' })
export type CareRecord = CareInput & {
  id: string
  babyId: string
  author: string
  authorName: string
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export interface CareDay {
  date: string
  feedings: number
  bottleMl: number
  unknownBottles: number
  formulaMl: number
  breastMilkMl: number
  nursingMs: number
  sleepMs: number
  sleeps: number
  changes: number
  wet: number
  dirty: number
}
export interface CarePage {
  records: CareRecord[]
  active: CareRecord[]
  days: CareDay[]
  timezone: string
  asOf: string
}

/** UTC instants travel over the API. The baby's IANA timezone controls calendar buckets. */
export function careInstant(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('请选择实际发生时间')
  }
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time < Date.UTC(1900, 0, 1) || time > now + 60_000 || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('发生时间无效或晚于当前时间')
  }
  return new Date(time).toISOString()
}
export function parseCare(value: unknown, now = Date.now()): CareInput {
  const v = object(value, ['kind', 'occurredAt', 'endedAt', 'note', 'state', 'parts', 'contents'])
  const occurredAt = careInstant(v.occurredAt, now)
  const endedAt = v.endedAt == null ? null : careInstant(v.endedAt, now)
  const note = text(v.note ?? '', '备注', 500, false)
  if (!['running', 'paused', 'completed'].includes(String(v.state))) {
    throw BabyErrorCode.BABY_INVALID_INPUT('计时状态无效')
  }
  const state = v.state as CareState
  if ((state !== 'completed' && endedAt) || (endedAt && endedAt < occurredAt)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('结束时间不能早于开始时间，进行中的记录不能填写结束时间')
  }
  if (endedAt && Date.parse(endedAt) - Date.parse(occurredAt) > 31 * 86400_000) {
    throw BabyErrorCode.BABY_INVALID_INPUT('单条计时最多跨 31 天，请核对时间')
  }
  const base = { occurredAt, endedAt, note, state }
  if (v.kind === 'sleep') {
    if (state === 'paused' || (state === 'completed' && !endedAt) || v.parts !== undefined || v.contents !== undefined) {
      throw BabyErrorCode.BABY_INVALID_INPUT('睡眠需要有效的开始、结束或进行中状态')
    }
    return { ...base, kind: 'sleep' }
  }
  if (v.kind === 'diaper') {
    if (state !== 'completed' || endedAt || v.parts !== undefined || !['wet', 'dirty', 'both', 'change'].includes(String(v.contents))) {
      throw BabyErrorCode.BABY_INVALID_INPUT('请选择尿布记录类型')
    }
    return { ...base, kind: 'diaper', contents: v.contents as 'wet' | 'dirty' | 'both' | 'change' }
  }
  if (v.kind !== 'feeding' || v.contents !== undefined || !Array.isArray(v.parts) || !v.parts.length || v.parts.length > 100) {
    throw BabyErrorCode.BABY_INVALID_INPUT('每次喂养需包含 1 至 100 段瓶喂或亲喂记录')
  }
  let previousEnd = occurredAt
  let open = 0
  const parts: FeedingPart[] = v.parts.map((input) => {
    const p = object(input, ['kind', 'milk', 'amountMl', 'side', 'startedAt', 'endedAt', 'occurredAt'])
    if (p.kind === 'bottle') {
      if (!['formula', 'breast_milk'].includes(String(p.milk)) || p.side !== undefined || p.startedAt !== undefined || p.endedAt !== undefined) {
        throw BabyErrorCode.BABY_INVALID_INPUT('请选择瓶喂奶类')
      }
      const bottleAt = p.occurredAt == null ? undefined : careInstant(p.occurredAt, now)
      if (bottleAt && (bottleAt < occurredAt || (endedAt && bottleAt > endedAt) || (state === 'completed' && !endedAt && bottleAt !== occurredAt))) {
        throw BabyErrorCode.BABY_INVALID_INPUT('瓶喂时间需在本次喂养开始和结束时间内')
      }
      return { kind: 'bottle', milk: p.milk as BottlePart['milk'], amountMl: p.amountMl == null ? null : integer(p.amountMl, '实际奶量（毫升）', 1, 3000), ...(bottleAt ? { occurredAt: bottleAt } : {}) }
    }
    if (p.kind !== 'nursing' || !['left', 'right'].includes(String(p.side)) || p.milk !== undefined || p.amountMl !== undefined || p.occurredAt !== undefined) {
      throw BabyErrorCode.BABY_INVALID_INPUT('请选择亲喂侧别')
    }
    const startedAt = careInstant(p.startedAt, now)
    const end = p.endedAt == null ? null : careInstant(p.endedAt, now)
    if (open || startedAt < previousEnd || (end && end < startedAt) || (endedAt && (end ?? new Date(now).toISOString()) > endedAt)) {
      throw BabyErrorCode.BABY_INVALID_INPUT('亲喂分段不能重叠，且需位于本次喂养时间内')
    }
    if (!end) {
      open++
    }
    previousEnd = end ?? startedAt
    return { kind: 'nursing', side: p.side as NursingPart['side'], startedAt, endedAt: end }
  })
  if ((state === 'running' && open !== 1) || (state !== 'running' && open) || (state === 'completed' && parts.some((p) => p.kind === 'nursing') && !endedAt)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('请先结束亲喂计时，再完成本次喂养')
  }
  if (state !== 'completed' && !parts.some((p) => p.kind === 'nursing')) {
    throw BabyErrorCode.BABY_INVALID_INPUT('瓶喂填写奶量后直接保存，无需启动计时')
  }
  return { ...base, kind: 'feeding', parts }
}

export function careInput(record: CareRecord): CareInput {
  const base = { occurredAt: record.occurredAt, endedAt: record.endedAt, note: record.note, state: record.state }
  return record.kind === 'feeding'
    ? { ...base, kind: 'feeding', parts: record.parts.map((part) => ({ ...part })) }
    : record.kind === 'diaper'
      ? { ...base, kind: 'diaper', contents: record.contents }
      : { ...base, kind: 'sleep' }
}
