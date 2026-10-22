import { ErrorCode } from '../../error-codes.js'
import { createDataSource } from '../data-source.js'
import { upgradeBabyDiary } from './baby-diary.js'

if (
  process.argv
    .slice(2)
    .some((arg) => !['--check', '--extensions-only'].includes(arg))
) {
  throw ErrorCode.INTERNAL_INVALID_INITIALIZATION_ARGUMENTS()
}
const source = await createDataSource().initialize()
try {
  const result = await upgradeBabyDiary(
    source,
    process.argv.includes('--check'),
    { extensionsOnly: process.argv.includes('--extensions-only') },
  )
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await source.destroy()
}
