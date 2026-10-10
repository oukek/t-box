import { isIP } from 'node:net';
/** Build-time public identity. Merchant credentials belong exclusively to the API database. */
export function validateWechatConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['enabled', 'appId', 'universalLink', 'iosTeamId'].includes(k)) ||
      typeof input.enabled !== 'boolean' ||
      ['appId', 'universalLink', 'iosTeamId'].some(k => typeof input[k] !== 'string')) {
    throw new Error('Invalid capacitor/wechat.config.json public configuration');
  }
  const config = { ...input };
  if (config.appId && !/^wx[A-Za-z0-9]{8,30}$/.test(config.appId)) throw new Error('Invalid mobile application AppID');
  if (config.iosTeamId && !/^[A-Z0-9]{10}$/.test(config.iosTeamId)) throw new Error('iOS Team ID must have 10 letters/digits');
  let domain = '';
  if (config.universalLink) {
    const u = new URL(config.universalLink);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port ||
        isIP(u.hostname) || !u.hostname.includes('.') || !u.pathname.endsWith('/') ||
        u.pathname === '/' || /[*?]/.test(u.pathname)) throw new Error('Universal Link must be public HTTPS with a dedicated path ending in /');
    config.universalLink = u.href;
    domain = u.hostname;
  }
  if (config.enabled && (!config.appId || !config.universalLink || !config.iosTeamId)) {
    throw new Error('Enabling APP payments requires mobile AppID, Universal Link and iOS Team ID');
  }
  return { ...config, domain };
}
export function iosWechatPlist(info, config) {
  const next = { ...info, TBoxWechatEnabled: config.enabled, TBoxWechatAppId: config.appId,
    TBoxWechatUniversalLink: config.universalLink };
  const name = 'com.tbox.wechatpay';
  next.CFBundleURLTypes = (info.CFBundleURLTypes ?? []).filter(t => t.CFBundleURLName !== name);
  if (config.appId) next.CFBundleURLTypes.push({ CFBundleURLName: name, CFBundleURLSchemes: [config.appId] });
  next.LSApplicationQueriesSchemes = [...new Set(['weixin', 'weixinULAPI', 'weixinURLParamsAPI', ...(info.LSApplicationQueriesSchemes ?? [])])];
  return next;
}
export function association(config, bundleId) {
  return { applinks: { apps: [], details: config.enabled ? [{ appID: `${config.iosTeamId}.${bundleId}`,
    paths: [`${new URL(config.universalLink).pathname}*`] }] : [] } };
}
