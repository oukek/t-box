import { readFileSync, writeFileSync } from 'node:fs'
import { releaseVersions } from '../../scripts/release-versions.mjs'

const root = new URL('../', import.meta.url)
const androidPath = new URL('android/app/build.gradle', root)
const iosPath = new URL('ios/App/App.xcodeproj/project.pbxproj', root)
const android = readFileSync(androidPath, 'utf8')
const ios = readFileSync(iosPath, 'utf8')
if (!/versionCode\s+\d+/.test(android) || !/versionName\s+"[^"]+"/.test(android) ||
  !/CURRENT_PROJECT_VERSION = [^;]+;/.test(ios) || !/MARKETING_VERSION = [^;]+;/.test(ios)) {
  throw new Error('Native version fields are missing. No files were changed.')
}

const requested = process.env.APP_BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER
if (requested !== undefined && (!/^[1-9]\d*$/.test(requested) || Number(requested) > 2100000000)) {
  throw new Error('Build number must be an integer between 1 and 2100000000.')
}
// Keep existing build numbers on local sync; never silently reset a release to 1.
const nextAndroid = android.replace(/versionName\s+"[^"]+"/, `versionName "${releaseVersions.android}"`)
const nextIos = ios.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${releaseVersions.ios};`)
writeFileSync(androidPath, requested === undefined
  ? nextAndroid
  : nextAndroid.replace(/versionCode\s+\d+/, `versionCode ${requested}`))
writeFileSync(iosPath, requested === undefined
  ? nextIos
  : nextIos.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${requested};`))
console.log(`Synced iOS ${releaseVersions.ios}, Android ${releaseVersions.android}; build number ${requested ?? 'preserved'}.`)
