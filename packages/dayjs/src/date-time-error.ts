export class DateTimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DateTimeError'
  }
}
