import type { CareDay, CareRecord } from '@t-box/baby-diary-contracts/care'
import { dayjs } from '@t-box/dayjs'

const overlap = (a: number, b: number, start: number, end: number) => Math.max(0, Math.min(b, end) - Math.max(a, start))
/** Recompute each midnight in the IANA zone: DST days are not always 24 hours. */
export function careDayBounds(date: string, timezone: string) {
  const next = dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD')
  return { start: dayjs.tz(`${date} 00:00:00`, timezone).valueOf(), end: dayjs.tz(`${next} 00:00:00`, timezone).valueOf() }
}
export function careDays(records: readonly CareRecord[], from: string, to: string, timezone: string, now = Date.now()): CareDay[] {
  const days: CareDay[] = []
  for (let date = from; date <= to; date = dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD')) {
    const { start, end } = careDayBounds(date, timezone)
    const day: CareDay = { date, feedings: 0, bottleMl: 0, unknownBottles: 0, formulaMl: 0, breastMilkMl: 0, nursingMs: 0, sleepMs: 0, sleeps: 0, changes: 0, wet: 0, dirty: 0 }
    // Sleep unions avoid double-counting accidentally overlapping backfilled sessions.
    const sleep: [number, number][] = []
    for (const row of records) {
      if (row.deletedAt) {
        continue
      }
      const at = Date.parse(row.occurredAt)
      const beginsToday = at >= start && at < end
      if (row.kind === 'sleep') {
        const finish = Math.min(Date.parse(row.endedAt ?? new Date(now).toISOString()), now)
        if (beginsToday) {
          day.sleeps++
        }
        if (overlap(at, finish, start, end)) {
          sleep.push([Math.max(at, start), Math.min(finish, end)])
        }
      } else if (row.kind === 'feeding') {
        if (beginsToday) {
          day.feedings++
        }
        for (const part of row.parts) {
          if (part.kind === 'nursing') {
            day.nursingMs += overlap(Date.parse(part.startedAt), Math.min(Date.parse(part.endedAt ?? new Date(now).toISOString()), now), start, end)
          } else if (Date.parse(part.occurredAt ?? row.occurredAt) >= start && Date.parse(part.occurredAt ?? row.occurredAt) < end) {
            if (part.amountMl === null) {
              day.unknownBottles++
            } else {
              day.bottleMl += part.amountMl
              day[part.milk === 'formula' ? 'formulaMl' : 'breastMilkMl'] += part.amountMl
            }
          }
        }
      } else if (beginsToday) {
        day.changes++
        day.wet += Number(row.contents === 'wet' || row.contents === 'both')
        day.dirty += Number(row.contents === 'dirty' || row.contents === 'both')
      }
    }
    sleep.sort((a, b) => a[0] - b[0])
    let lastEnd = start
    for (const [a, b] of sleep) {
      day.sleepMs += Math.max(0, b - Math.max(a, lastEnd))
      lastEnd = Math.max(lastEnd, b)
    }
    days.push(day)
  }
  return days
}
export function careDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`
}
export function careTitle(record: CareRecord, now = Date.now()) {
  if (record.kind === 'diaper') {
    return { wet: '尿尿', dirty: '便便', both: '尿尿＋便便', change: '换尿布' }[record.contents]
  }
  if (record.kind === 'sleep') {
    return `睡眠 · ${careDuration(Date.parse(record.endedAt ?? new Date(now).toISOString()) - Date.parse(record.occurredAt))}`
  }
  return record.parts.map((part) => part.kind === 'bottle'
    ? `${part.milk === 'formula' ? '配方奶' : '母乳瓶喂'} ${part.amountMl === null ? '奶量未填' : `${part.amountMl} mL`}`
    : `亲喂${part.side === 'left' ? '左' : '右'}侧 ${careDuration(Date.parse(part.endedAt ?? new Date(now).toISOString()) - Date.parse(part.startedAt))}`).join(' · ')
}
