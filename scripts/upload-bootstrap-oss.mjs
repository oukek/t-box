import { ossSettings, publishBootstrap } from './oss-static.mjs'

if (process.argv.length !== 3) {
  throw new Error('Usage: node scripts/upload-bootstrap-oss.mjs BOOTSTRAP_ARTIFACT_DIRECTORY')
}
const settings = ossSettings(process.env.APPS_OSS_BUCKET, process.env.APP_ARTIFACT_ORIGIN)
if (process.argv[2] !== '--check') {
  await publishBootstrap(process.argv[2], settings)
}
console.info('Bootstrap application static files published and verified on OSS.')
