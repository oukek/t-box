import type { DesktopArtifact } from '../db/records/system-versions.js'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import OSS from 'ali-oss'
import { resourceStorageSettings } from '../config.js'
import { ErrorCode } from '../error-codes.js'

export type Component = 'ui' | 'core'
export function artifactKey(kind: Component, artifact: DesktopArtifact) {
  return `desktop-candidates/${artifact.build}/${artifact.digest}.${kind === 'ui' ? 'json' : 'app.tar.gz'}`
}
export function desktopStorage() {
  const options = resourceStorageSettings()
  if (!options) {
    throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('请配置桌面制品存储')
  }
  const client = new OSS({ ...options, bucket: process.env.WEB_OSS_BUCKET || 'tboxos', region: 'oss-' + options.region, secure: true, authorizationV4: true })
  return {
    async read(kind: Component, item: DesktopArtifact) {
      const key = artifactKey(kind, item)
      const head = await client.head(key)
      const size = Number((head.res.headers as Record<string, unknown>)['content-length'])
      if (!Number.isSafeInteger(size) || size < 1 || size > (kind === 'ui' ? 32 : 128) * 1024 ** 2) {
        throw ErrorCode.INVALID_APP_BUILD('桌面制品大小不符合要求')
      }
      return Buffer.from((await client.get(key)).content)
    },
    url(kind: Component, item: DesktopArtifact, filename?: string) {
      const request = filename ? { queries: { 'response-content-disposition': 'attachment; filename="' + filename + '"' } } : {}
      return client.signatureUrlV4('GET', filename ? 300 : 3600, request, artifactKey(kind, item))
    },
  }
}

// Minisign ED authenticates the BLAKE2b-512 digest. The second signature binds the trusted comment.
function verifySignature(bytes: Buffer, item: DesktopArtifact, pubkey: string) {
  const key = Buffer.from(Buffer.from(pubkey, 'base64').toString().trim().split('\n')[1] ?? '', 'base64')
  const [, packet = '', comment = '', global = ''] = Buffer.from(item.signature, 'base64').toString().trim().split('\n')
  const sig = Buffer.from(packet, 'base64')
  if (sig.length !== 74 || key.length !== 42 || sig.toString('ascii', 0, 2) !== 'ED' || !key.subarray(2, 10).equals(sig.subarray(2, 10)) || !comment.startsWith('trusted comment: ')) {
    throw new Error('签名格式无效')
  }
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)])
  const pk = createPublicKey({ key: der, type: 'spki', format: 'der' })
  const trusted = comment.slice(17)
  if (!verify(null, createHash('blake2b512').update(bytes).digest(), pk, sig.subarray(10)) || !verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), pk, Buffer.from(global, 'base64'))) {
    throw new Error('签名无效')
  }
  return trusted
}

function checkCore(bytes: Buffer, item: DesktopArtifact, ui: DesktopArtifact) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 ** 2 })
  const files = new Map<string, Buffer>()
  const root = 'T方舟.app/Contents/'
  for (let offset = 0; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512)
    if (block.every((byte) => byte === 0)) {
      break
    }
    const name = block.toString('utf8', 0, 100).split('\0')[0]!
    const size = Number.parseInt(block.toString('ascii', 124, 136).replace(/\0/g, '').trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error('核心归档格式无效')
    }
    if (name.startsWith(root) && [0, 48].includes(block[156]!)) {
      files.set(name.slice(root.length), tar.subarray(offset + 512, offset + 512 + size))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  const binary = files.get('MacOS/tbox-desktop')
  const plist = files.get('Info.plist')?.toString() ?? ''
  const contract = JSON.parse(files.get('Resources/desktop-release.json')?.toString() ?? '{}')
  if (binary?.readUInt32LE(0) !== 0xFEEDFACF || binary.readUInt32LE(4) !== 0x0100000C || !/<key>CFBundleIdentifier<\/key>\s*<string>cn\.tboxos\.desktop<\/string>/.test(plist) || /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)/.exec(plist)?.[1] !== item.version ||
    contract.protocol !== 1 || contract.uiDigest !== ui.digest || contract.uiVersion !== ui.version) {
    throw new Error('核心架构、版本或内置界面不兼容')
  }
}
export async function checkArtifact(store: ReturnType<typeof desktopStorage>, kind: Component, item: DesktopArtifact, ui: DesktopArtifact) {
  const key = process.env[kind === 'ui' ? 'TBOX_UI_PUBLIC_KEY' : 'TBOX_CORE_PUBLIC_KEY']
  if (!key) {
    throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('请配置桌面制品签名公钥')
  }
  const bytes = await store.read(kind, item)
  try {
    if (createHash('sha256').update(bytes).digest('hex') !== item.digest) {
      throw new Error('摘要不匹配')
    }
    const comment = verifySignature(bytes, item, key)
    if (kind === 'core') {
      if (!comment.split('\t').includes('version:' + item.version)) {
        throw new Error('签名目标版本不匹配')
      }
      checkCore(bytes, item, ui)
    } else {
      const bundle = JSON.parse(bytes.toString())
      if (bundle.version !== item.version || bundle.protocol !== 1 || !bundle.files?.['index.html'] || Object.keys(bundle.files).length > 4096 ||
        Object.entries(bundle.files).some(([path, value]) => path.length > 240 || !path.split('/').every((p) => /^[\w@-][\w.@-]*$/.test(p)) || typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value)) {
        throw new Error('界面协议、文件或版本无效')
      }
    }
    return bytes.length
  } catch {
    throw ErrorCode.INVALID_APP_BUILD('桌面制品签名、摘要、架构或兼容信息不匹配')
  }
}
