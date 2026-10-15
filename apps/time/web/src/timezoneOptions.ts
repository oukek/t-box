import { timeSnapshot } from '@t-box/time-contracts'

/** Resolve the current offset, including DST and non-whole-hour timezones. */
export function timezoneOptions(zones: readonly { value: string, label: string }[], instant: number) {
  const date = new Date(instant)
  return zones.map((zone) => ({ ...zone, suffix: `UTC${timeSnapshot(zone.value, date).offset}` }))
}
