import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import plist from 'plist'
import { navigationAssociation, navigationInfo, validateNavigationConfig } from './navigation-config.mjs'

const root = resolve(import.meta.dirname, '..')
const config = validateNavigationConfig(JSON.parse(readFileSync(resolve(root, 'navigation.config.json'), 'utf8')))
const directory = resolve(root, 'ios/App/App')
const project = readFileSync(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
const bundleId = project.match(/PRODUCT_BUNDLE_IDENTIFIER = ([\w.]+);/)?.[1]
if (!bundleId) {
  throw new Error('Cannot determine the iOS Bundle ID')
}
const infos = ['Info.plist', 'Info-Debug.plist'].map((name) => ({ path: resolve(directory, name), info: plist.parse(readFileSync(resolve(directory, name), 'utf8')) }))
const entitlementsPath = resolve(directory, 'App.entitlements')
const entitlements = plist.parse(readFileSync(entitlementsPath, 'utf8'))
const old = infos[0].info.TBoxNavigationOrigin
const previousDomain = old ? `applinks:${new URL(old).hostname}` : null
const wechatDomain = infos[0].info.TBoxWechatEnabled && infos[0].info.TBoxWechatUniversalLink ? `applinks:${new URL(infos[0].info.TBoxWechatUniversalLink).hostname}` : null
const domains = (entitlements['com.apple.developer.associated-domains'] || []).filter((domain) => domain !== previousDomain || domain === wechatDomain)
if (config.universalLinkOrigin) {
  domains.push(`applinks:${new URL(config.universalLinkOrigin).hostname}`)
}
if (domains.length) {
  entitlements['com.apple.developer.associated-domains'] = [...new Set(domains)]
} else {
  delete entitlements['com.apple.developer.associated-domains']
}
for (const item of infos) {
  writeFileSync(item.path, plist.build(navigationInfo(item.info, config)) + '\n')
}
writeFileSync(entitlementsPath, plist.build(entitlements) + '\n')
const output = resolve(root, 'generated/navigation')
mkdirSync(output, { recursive: true })
const wechatAssociation = resolve(root, 'generated/apple-app-site-association')
const previous = existsSync(wechatAssociation) ? JSON.parse(readFileSync(wechatAssociation, 'utf8')) : {}
writeFileSync(resolve(output, 'apple-app-site-association'), JSON.stringify(navigationAssociation(config, bundleId, previous), null, 2) + '\n')
console.info('Native navigation schemes and Universal Links synced.')
