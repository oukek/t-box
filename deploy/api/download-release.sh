#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$script_dir/release-common.sh"
[[ $# == 1 ]] || fail 'Usage: bash download-release.sh RELEASE_ID'
release_id="$1"
validate_release_id "$release_id"
need_commands ossutil docker jq gzip sha256sum flock
load_oss_settings
mkdir -p "$script_dir/releases"
exec 9>"$script_dir/.download.lock"
flock -n 9 || fail 'Another download/import is already running'
folder="$script_dir/releases/$release_id"
temporary=''
trap 'if [[ -n "$temporary" ]]; then rm -rf -- "$temporary"; fi' EXIT
if [[ ! -d "$folder" ]]; then
  temporary="$(mktemp -d "$script_dir/releases/.download.XXXXXX")"
  origin="oss://$OSS_BUCKET/$OSS_PREFIX/releases/$release_id"
  ossutil cp "$origin/release.json" "$temporary/release.json" --force
  validate_manifest "$temporary" "$release_id"
  ossutil cp "$origin/image.tar.gz.sha256" "$temporary/image.tar.gz.sha256" --force
  ossutil cp "$origin/image.tar.gz" "$temporary/image.tar.gz" --force
  verify_archive "$temporary" "$release_id"
  mv "$temporary" "$folder"
  temporary=''
fi
# Cached releases must pass the same checks on every import.
verify_archive "$folder" "$release_id"
platform="$(docker info --format '{{.OSType}}/{{.Architecture}}')"
case "$platform" in
  linux/x86_64|linux/amd64) architecture=amd64 ;;
  linux/aarch64|linux/arm64) architecture=arm64 ;;
  *) fail "Unsupported Docker daemon platform: $platform" ;;
esac
[[ "$(jq -r '.image.architecture' "$folder/release.json")" == "$architecture" ]] ||
  fail 'Image architecture does not match the server Docker daemon'
docker image load --input "$folder/image.tar.gz"
image="$(jq -r '.image.tag' "$folder/release.json")"
expected_id="$(jq -r '.image.id' "$folder/release.json")"
docker image inspect "$image" | jq -e --arg id "$expected_id" --arg arch "$architecture" \
  'length == 1 and .[0].Id == $id and .[0].Os == "linux" and .[0].Architecture == $arch' >/dev/null ||
  fail 'Imported image identity does not match the release manifest'
printf 'Verified and imported: %s\n' "$image"
