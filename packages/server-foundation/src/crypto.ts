import {
  createHash,
  scrypt as derive,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(derive)
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${hash.toString('hex')}`
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(':')
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) {
    return false
  }
  const actual = (await scrypt(password, salt, 64)) as Buffer
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'))
}
