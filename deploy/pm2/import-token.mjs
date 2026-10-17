import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export function importTokenHash(value) {
  if (typeof value !== 'string' || !/^[\w-]{32,128}$/.test(value)) {
    throw new Error('Configure APP_IMPORT_TOKEN as 32-128 random letters, digits, underscores or hyphens')
  }
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  const output = process.argv[2]
  if (!output || process.argv.length !== 3) {
    throw new Error('Usage: node deploy/pm2/import-token.mjs HASH_FILE | --check')
  }
  const hash = importTokenHash(process.env.APP_IMPORT_TOKEN)
  if (output !== '--check') {
    await writeFile(output, hash + '\n', { mode: 0o600, flag: 'wx' })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  })
}
