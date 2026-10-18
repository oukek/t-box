import { createOssClient, downloadOssObject, ossClientOptions, putOssObject } from './client.mjs'

async function main() {
  const [operation, key, localFile, argument] = process.argv.slice(2)
  if (process.argv.length !== 6 || !['upload', 'download'].includes(operation) || !key || !localFile) {
    throw new Error('Usage: node transfer.mjs upload KEY FILE MIME | download KEY FILE SIZE_LIMIT')
  }
  const client = createOssClient(ossClientOptions(process.env.OSS_BUCKET, process.env, { allowInternal: true }))
  if (operation === 'upload') {
    if (!['application/gzip', 'application/json', 'text/plain'].includes(argument)) {
      throw new Error('Unsupported release object MIME type')
    }
    await putOssObject(client, key, localFile, { mime: argument, headers: {
      'x-oss-object-acl': 'public-read',
      'Cache-Control': 'public,max-age=31536000,immutable',
    } })
  } else {
    await downloadOssObject(client, key, localFile, Number(argument))
  }
}

main().catch((error) => {
  process.stderr.write(error.message + '\n')
  process.exitCode = 1
})
