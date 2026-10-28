import { ossSettings, publishBootstrap } from './oss-static.mjs'

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/upload-bootstrap-oss.mjs BOOTSTRAP_ARTIFACT_DIRECTORY')
  }
  const settings = ossSettings(process.env.APPS_OSS_BUCKET, process.env.APP_ARTIFACT_ORIGIN)
  if (process.argv[2] === '--check') {
    console.info('Bootstrap application OSS settings validated.')
    return
  }
  const verification = { ossOnly: false }
  await publishBootstrap(process.argv[2], settings, { verification })
  console.info('Bootstrap application static files published and verified on OSS.')
  if (verification.ossOnly) {
    console.warn('CDN/custom-domain reachability was not verified from this runner; check the application URLs from the target user network.')
  }
}

await main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
