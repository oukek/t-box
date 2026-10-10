import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
// Native stores require a numeric release version, not semver prerelease tags.
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Invalid native version: ${version}. Use a numeric version such as 1.2.3.`);
}

const androidPath = new URL('android/app/build.gradle', root);
const iosPath = new URL('ios/App/App.xcodeproj/project.pbxproj', root);
const android = readFileSync(androidPath, 'utf8');
const ios = readFileSync(iosPath, 'utf8');
if (!/versionCode\s+\d+/.test(android) || !/versionName\s+"[^"]+"/.test(android)
  || !/CURRENT_PROJECT_VERSION = [^;]+;/.test(ios) || !/MARKETING_VERSION = [^;]+;/.test(ios)) {
  throw new Error('Native version fields are missing. No files were changed.');
}

const requested = process.env.APP_BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER;
if (requested !== undefined && (!/^[1-9]\d*$/.test(requested) || Number(requested) > 2100000000)) {
  throw new Error('Build number must be an integer between 1 and 2100000000.');
}
// Keep existing build numbers on local sync; never silently reset a release to 1.
const nextAndroid = android.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
const nextIos = ios.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
writeFileSync(androidPath, requested === undefined ? nextAndroid
  : nextAndroid.replace(/versionCode\s+\d+/, `versionCode ${requested}`));
writeFileSync(iosPath, requested === undefined ? nextIos
  : nextIos.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${requested};`));
console.log(`Synced native version ${version}; build number ${requested ?? 'preserved'}.`);
