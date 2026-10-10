import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import plist from 'plist';
import { validateWechatConfig, iosWechatPlist, association } from './wechat-config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = validateWechatConfig(JSON.parse(readFileSync(resolve(root, 'wechat.config.json'), 'utf8')));
// Validate all identities before changing any generated file.
const androidRoot = resolve(root, 'android/app/src/main');
const androidBuild = readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8');
const packageId = androidBuild.match(/applicationId\s+"([A-Za-z0-9_.]+)"/)?.[1];
if (!packageId) throw new Error('Cannot determine Android applicationId');
const iosProject = readFileSync(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const bundleId = iosProject.match(/PRODUCT_BUNDLE_IDENTIFIER = ([A-Za-z0-9_.]+);/)?.[1];
if (!bundleId) throw new Error('Cannot determine iOS Bundle ID');
const infoPaths = ['Info.plist', 'Info-Debug.plist'].map(n => resolve(root, 'ios/App/App', n)).filter(existsSync);
const infos = infoPaths.map(p => [p, iosWechatPlist(plist.parse(readFileSync(p, 'utf8')), config)]);
const entitlementsPath = resolve(root, 'ios/App/App/App.entitlements');
const entitlements = existsSync(entitlementsPath) ? plist.parse(readFileSync(entitlementsPath, 'utf8')) : {};
// Preserve domains used by other features and replace only this script's previous domain.
const oldDomain = infos[0] ? plist.parse(readFileSync(infos[0][0], 'utf8')).TBoxWechatUniversalLink : '';
const oldHost = oldDomain ? new URL(oldDomain).hostname : '';
const domains = (entitlements['com.apple.developer.associated-domains'] ?? []).filter(d => d !== `applinks:${oldHost}`);
if (config.enabled) domains.push(`applinks:${config.domain}`);
if (domains.length) entitlements['com.apple.developer.associated-domains'] = [...new Set(domains)];
else delete entitlements['com.apple.developer.associated-domains'];
const resource = resolve(androidRoot, 'res/values/wechat.xml');
mkdirSync(dirname(resource), { recursive: true });
writeFileSync(resource, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="tbox_wechat_enabled" translatable="false">${config.enabled}</string>\n  <string name="tbox_wechat_app_id" translatable="false">${config.appId}</string>\n</resources>\n`);
// WeChat requires the callback class to live under the actual Android applicationId.
const callback = resolve(androidRoot, 'java', ...packageId.split('.'), 'wxapi/WXPayEntryActivity.java');
mkdirSync(dirname(callback), { recursive: true });
writeFileSync(callback, `package ${packageId}.wxapi;\nimport com.tbox.plugins.wechatpay.WechatPayCallbackActivity;\npublic class WXPayEntryActivity extends WechatPayCallbackActivity {}\n`);
for (const [path, info] of infos) writeFileSync(path, plist.build(info) + '\n');
writeFileSync(entitlementsPath, plist.build(entitlements) + '\n');
const generated = resolve(root, 'generated');
mkdirSync(generated, { recursive: true });
writeFileSync(resolve(generated, 'apple-app-site-association'), JSON.stringify(association(config, bundleId), null, 2) + '\n');
console.log(`WeChat APP payment: ${config.enabled ? 'enabled' : 'disabled'}; public native configuration synced.`);
