import { readFileSync } from 'node:fs'

export const releaseVersions = JSON.parse(readFileSync(new URL('../release-versions.json', import.meta.url), 'utf8'))
for (const key of ['ui', 'macos.core', 'ios', 'android']) {
  const value = key.split('.').reduce((object, field) => object?.[field], releaseVersions)
  if (typeof value !== 'string' || value.length > 96 || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`release-versions.json 中的 ${key} 必须填写完整版本号，例如 1.2.15`)
  }
}
