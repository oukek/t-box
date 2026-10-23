export function validateNavigationConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['universalLinkOrigin', 'iosTeamId'].includes(key)) || typeof value.universalLinkOrigin !== 'string' || typeof value.iosTeamId !== 'string') {
    throw new Error('Invalid native navigation configuration')
  }
  if (!value.universalLinkOrigin && !value.iosTeamId) {
    return { ...value }
  }
  const url = new URL(value.universalLinkOrigin)
  if (url.protocol !== 'https:' || url.origin !== value.universalLinkOrigin || url.username || url.password || !/^[A-Z0-9]{10}$/.test(value.iosTeamId)) {
    throw new Error('Universal Links require an HTTPS origin and a 10-character Apple Team ID')
  }
  return { ...value }
}
export function navigationInfo(info, config) {
  return { ...info, TBoxNavigationOrigin: config.universalLinkOrigin, CFBundleURLTypes: [...(info.CFBundleURLTypes || []).filter((entry) => entry.CFBundleURLName !== 'com.tbox.app.navigation'), { CFBundleURLName: 'com.tbox.app.navigation', CFBundleURLSchemes: ['tbox'] }] }
}
export function navigationAssociation(config, bundleId, previous = {}) {
  const details = [...(previous.applinks?.details || [])]
  if (config.universalLinkOrigin) {
    const appID = `${config.iosTeamId}.${bundleId}`
    const existing = details.find((entry) => entry.appID === appID)
    if (existing) {
      existing.paths = [...new Set([...(existing.paths || []), '/open/*'])]
    } else {
      details.push({ appID, paths: ['/open/*'] })
    }
  }
  return { applinks: { apps: [], details } }
}
