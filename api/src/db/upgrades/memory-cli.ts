import { ErrorCode } from '../../error-codes.js'
import { createDataSource } from '../data-source.js'
import { upgradePlatformExtensions } from './platform-extensions.js'

if (
  process.argv
    .slice(2)
    .some((argument) => !['--check', '--extensions-only'].includes(argument))
) {
  throw ErrorCode.INTERNAL_INVALID_INITIALIZATION_ARGUMENTS()
}
const source = await createDataSource().initialize()
try {
  process.stdout.write(
    `${JSON.stringify(await upgradePlatformExtensions(source, process.argv.includes('--check'), { extensionsOnly: process.argv.includes('--extensions-only') }))}\n`,
  )
} finally {
  await source.destroy()
}
