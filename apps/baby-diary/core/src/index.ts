import type {
  CreativeFrame,
  GrowthRecord,
  PlaybackSettings,
} from '@t-box/baby-diary-contracts'
import { dayjs } from '@t-box/dayjs'

/** Calendar months, not multiples of 30 days. Pure functions run identically on both sides. */
export function babyAge(birthDate: string | null, onDate: string): string {
  if (!birthDate) {
    return '记录每一天'
  }
  const birth = dayjs.utc(birthDate)
  const on = dayjs.utc(onDate)
  if (!birth.isValid() || !on.isValid() || on.isBefore(birth)) {
    return '出生前'
  }
  const months = on.diff(birth, 'month')
  const days = on.diff(birth.add(months, 'month'), 'day')
  if (!months) {
    return `${days} 天`
  }
  const years = Math.floor(months / 12)
  return `${years ? `${years} 岁` : ''}${months % 12 ? `${months % 12} 个月` : ''}${days ? ` ${days} 天` : ''}`
}
export function playbackPosition(
  elapsedMs: number,
  count: number,
  settings: PlaybackSettings,
) {
  if (!count) {
    return { index: 0, next: 0, progress: 0, done: true }
  }
  const duration = count * settings.frameMs
  const elapsed = Math.max(0, elapsedMs)
  const done = !settings.loop && elapsed >= duration
  const time = done ? duration - 1 : elapsed % duration
  const position = Math.min(count - 1, Math.floor(time / settings.frameMs))
  const nextPosition =
    done || (!settings.loop && position === count - 1)
      ? position
      : (position + 1) % count
  const offset = time % settings.frameMs
  const progress =
    settings.transition === 'cut' ||
    !settings.transitionMs ||
    nextPosition === position
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            (offset - settings.frameMs + settings.transitionMs) /
            settings.transitionMs,
          ),
        )
  return {
    index: settings.reverse ? count - 1 - position : position,
    next: settings.reverse ? count - 1 - nextPosition : nextPosition,
    progress,
    done,
  }
}
export function projectFrames(
  frames: readonly CreativeFrame[],
  from = '',
  to = '',
) {
  return frames.filter(
    (frame) => (!from || frame.date >= from) && (!to || frame.date <= to),
  )
}
export function measurementSeries(
  records: readonly GrowthRecord[],
  metric: 'heightMm' | 'weightGrams' | 'headMm',
) {
  return records
    .filter(
      (record) => !record.deletedAt && record.measurement?.[metric] != null,
    )
    .map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      date: record.date,
      value: record.measurement![metric]!,
      method: record.measurement!.method,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
}
export function frameTransform(
  frame: Pick<CreativeFrame, 'x' | 'y' | 'scale' | 'rotation'>,
) {
  return `translate(${frame.x}%, ${frame.y}%) rotate(${frame.rotation}deg) scale(${frame.scale})`
}

export * from './care-outbox.js'
export * from './care.js'
