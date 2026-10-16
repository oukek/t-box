#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$script_dir/release-common.sh"
[[ $# == 2 ]] || fail 'Usage: bash upload-release.sh RELEASE_ID EXPORT_DIRECTORY'
release_id="$1"
folder="$2"
validate_release_id "$release_id"
need_commands ossutil jq gzip sha256sum
load_oss_settings
verify_archive "$folder" "$release_id"
destination="oss://$OSS_BUCKET/$OSS_PREFIX/releases/$release_id"
# release.json is uploaded LAST: its existence marks a complete release.
ossutil cp "$folder/image.tar.gz" "$destination/image.tar.gz" --force --acl public-read
ossutil cp "$folder/image.tar.gz.sha256" "$destination/image.tar.gz.sha256" --force --acl public-read
ossutil cp "$folder/release.json" "$destination/release.json" --force --acl public-read
printf 'Uploaded release: %s\n' "$destination"
