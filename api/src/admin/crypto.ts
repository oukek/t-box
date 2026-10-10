import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export { digest, hashPassword, verifyPassword } from '@t-box/server-foundation/crypto'
export function loadEncryptionKey() {
  const directory = new URL('../../.secrets/', import.meta.url)
  // src/admin and dist/admin both resolve to api/.secrets.
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = new URL('provider.key', directory)
  try {
    writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  const key = readFileSync(file)
  if (key.length !== 32) {
    throw new Error('Provider encryption key must contain 32 bytes')
  }
  return key
}
export function createVault(key: Buffer) {
  if (key.length !== 32) {
    throw new Error('Invalid vault key')
  }
  return {
    encrypt(value: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ])
      return [iv, cipher.getAuthTag(), bytes]
        .map((b) => b.toString('base64'))
        .join('.')
    },
    decrypt(value: string) {
      const [iv, tag, bytes] = value
        .split('.')
        .map((v) => Buffer.from(v, 'base64'))
      if (!iv || !tag || !bytes) {
        throw new Error('Invalid encrypted credential')
      }
      const cipher = createDecipheriv('aes-256-gcm', key, iv)
      cipher.setAuthTag(tag)
      return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(
        'utf8',
      )
    },
  }
}
