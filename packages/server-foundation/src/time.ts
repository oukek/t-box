/** MySQL DATETIME columns are UTC; never let the host timezone interpret them. */
export function isoTime(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(`${value.replace(' ', 'T')}Z`).toISOString()
}
