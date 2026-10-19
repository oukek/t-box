import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// No database, credentials, or model requests. Exercise production workspace entries.
const api = await realpath(fileURLToPath(new URL('.', import.meta.url)))
const pkg = JSON.parse(await readFile(join(api, 'package.json'), 'utf8'))
for (const name of Object.keys(pkg.dependencies).filter((name) => name.startsWith('@t-box/'))) {
  await import(name)
  const dependency = await realpath(join(api, 'node_modules', name))
  if (!dependency.startsWith(api + '/')) {
    throw new Error(`Workspace dependency escaped deployment: ${name}`)
  }
}
await import('./dist/db/data-source.js')
await import('./dist/chat/provider.js')
await import('./dist/resources/service.js')
await import('./dist/app.js')
const { ApiError } = await import('@t-box/errors')
const { ApiError: foundationApiError } = await import('@t-box/server-foundation/errors')
const { ErrorCode } = await import('./dist/error-codes.js')
if (ApiError !== foundationApiError || !(ErrorCode.NOT_FOUND() instanceof ApiError)) {
  throw new Error('Production packages must share the same ApiError class')
}
const { applicationBootstrapArtifacts, applicationSettings } = await import('./dist/config.js')
if (process.env.NODE_ENV === 'production' && applicationSettings().delivery === 'oss') {
  const bootstrap = applicationBootstrapArtifacts()
  if (['calculator', 'ledger', 'calendar', 'time', 'converter'].some((appId) => !bootstrap[appId])) {
    throw new Error('Production OSS bootstrap configuration is incomplete')
  }
  for (const path of [join(api, '.storage'), join(api, '../bootstrap/app-artifacts'), join(api, '../output/app-artifacts')]) {
    try {
      await lstat(path)
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    throw new Error('Production package contains persistent application files: ' + path)
  }
}
process.stdout.write('Production modules and isolated workspace dependencies verified.\n')
