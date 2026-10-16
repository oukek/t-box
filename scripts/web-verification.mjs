import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { association, validateWechatConfig } from '../capacitor/scripts/wechat-config.mjs'

export async function prepareWebVerification(root, dist, origin) {
  const config = validateWechatConfig(JSON.parse(await readFile(join(root, 'capacitor/wechat.config.json'), 'utf8')))
  if (!config.enabled) {
    return
  }
  if (new URL(config.universalLink).origin !== origin) {
    throw new Error('For automatic AASA publication, set the WeChat Universal Link to the WEB_ORIGIN domain')
  }
  const project = await readFile(join(root, 'capacitor/ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
  const bundleId = project.match(/PRODUCT_BUNDLE_IDENTIFIER = ([\w.]+);/)?.[1]
  if (!bundleId) {
    throw new Error('Cannot determine iOS Bundle ID for AASA')
  }
  const path = join(dist, '.well-known/apple-app-site-association')
  let current = {}
  try {
    current = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  const generated = association(config, bundleId).applinks.details[0]
  current.applinks = { ...current.applinks, apps: current.applinks?.apps || [], details: [...(current.applinks?.details || []).filter((item) => item.appID !== generated.appID), generated] }
  await mkdir(join(dist, '.well-known'), { recursive: true })
  await writeFile(path, JSON.stringify(current, null, 2) + '\n')
}
