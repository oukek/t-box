#!/usr/bin/env bash
set -euo pipefail
arch="$1"
archive="$2"
dmg="$3"
cpu="$arch"
if [[ "$arch" == aarch64 ]]; then cpu=arm64; fi
work="$(mktemp -d)"
mount="$work/image"
mkdir -p "$mount" "$work/update"
cleanup() {
  hdiutil detach "$mount" -quiet 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
tar -xzf "$archive" -C "$work/update"
# Staple a ticket to the final disk image as well as the app inside it.
xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount"
test "$(readlink "$mount/Applications")" = /Applications
for app in "$mount/T方舟.app" "$work/update/T方舟.app"; do
  test "$(lipo -archs "$app/Contents/MacOS/tbox-desktop")" = "$cpu"
  codesign --verify --deep --strict "$app"
  identity="$(codesign -dv --verbose=4 "$app" 2>&1)"
  grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$identity"
  grep -q '^Authority=Developer ID Application:' <<< "$identity"
  xcrun stapler validate "$app"
  spctl --assess --type execute "$app"
done
cmp "$mount/T方舟.app/Contents/_CodeSignature/CodeResources" "$work/update/T方舟.app/Contents/_CodeSignature/CodeResources"
cmp "$mount/T方舟.app/Contents/MacOS/tbox-desktop" "$work/update/T方舟.app/Contents/MacOS/tbox-desktop"
