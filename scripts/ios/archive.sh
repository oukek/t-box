#!/usr/bin/env bash
# Run from the repository root on the disposable macOS release runner.
set -euo pipefail
umask 077
: "${IOS_P12_BASE64:?缺少 IOS_P12_BASE64}" "${IOS_P12_PASSWORD:?缺少证书密码}" "${IOS_PROFILE_BASE64:?缺少描述文件}" "${APPLE_TEAM_ID:?缺少团队编号}"
work=$(mktemp -d)
keychain="$work/signing.keychain-db"
project=capacitor/ios/App/App.xcodeproj/project.pbxproj
cp "$project" "$work/project.pbxproj"
cleanup() {
  cp "$work/project.pbxproj" "$project"
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
printf '%s' "$IOS_P12_BASE64" | base64 -D > "$work/dist.p12"
printf '%s' "$IOS_PROFILE_BASE64" | base64 -D > "$work/profile.mobileprovision"
security cms -D -i "$work/profile.mobileprovision" > "$work/profile.plist"
password=$(openssl rand -hex 24)
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$work/dist.p12" -k "$keychain" -P "$IOS_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain" > "$work/identities"
python3 scripts/ios/signing.py "$work" "$project"
profile_id=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/profile.plist")
profiles="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profiles"
cp "$work/profile.mobileprovision" "$profiles/$profile_id.mobileprovision"
xcodebuild -workspace capacitor/ios/App/App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$work/App.xcarchive" archive
xcodebuild -exportArchive -archivePath "$work/App.xcarchive" -exportPath "$work/export" -exportOptionsPlist "$work/export.plist"
ipa=("$work/export/"*.ipa)
test "${#ipa[@]}" -eq 1
mkdir -p output/ios
ditto -x -k "${ipa[0]}" "$work/check"
app=("$work/check/Payload/"*.app)
codesign --verify --deep --strict "${app[0]}"
plist="${app[0]}/Info.plist"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist")" = cn.tboxos.ark
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist")" = "$IOS_MARKETING_VERSION"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$plist")" = "$APP_BUILD_NUMBER"
test -s "${app[0]}/public/index.html"
mv "${ipa[0]}" output/ios/Tbox.ipa
