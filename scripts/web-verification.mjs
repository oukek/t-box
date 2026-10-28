import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { navigationAssociation, validateNavigationConfig } from '../capacitor/scripts/navigation-config.mjs'
import { association, validateWechatConfig } from '../capacitor/scripts/wechat-config.mjs'

export async function prepareWebVerification(root, dist, origin) {
  const config = validateWechatConfig(JSON.parse(await readFile(join(root, 'capacitor/wechat.config.json'), 'utf8')))
  const navigation = validateNavigationConfig(JSON.parse(await readFile(join(root, 'capacitor/navigation.config.json'), 'utf8')))
  if (!config.enabled && !navigation.universalLinkOrigin) {
    return
  }
  if (config.enabled && new URL(config.universalLink).origin !== origin) {
    throw new Error('For automatic AASA publication, set the WeChat Universal Link to the WEB_ORIGIN domain')
  }
  if (navigation.universalLinkOrigin && navigation.universalLinkOrigin !== origin) {
    throw new Error('For automatic AASA publication, set the navigation Universal Link to the WEB_ORIGIN domain')
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
  if (config.enabled) {
    const generated = association(config, bundleId).applinks.details[0]
    const details = current.applinks?.details || []
    const existing = details.find((item) => item.appID === generated.appID)
    const merged = { ...existing, ...generated, paths: [...new Set([...(existing?.paths || []), ...generated.paths])] }
    current.applinks = { ...current.applinks, apps: current.applinks?.apps || [], details: [...details.filter((item) => item.appID !== generated.appID), merged] }
  }
  const associated = navigationAssociation(navigation, bundleId, current)
  current.applinks = { ...current.applinks, ...associated.applinks }
  await mkdir(join(dist, '.well-known'), { recursive: true })
  await writeFile(path, JSON.stringify(current, null, 2) + '\n')
}
