#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$script_dir/release-common.sh"
[[ $# == 2 ]] || fail 'Usage: bash export-release.sh RELEASE_ID OUTPUT_DIRECTORY'
release_id="$1"
output="$2"
validate_release_id "$release_id"
need_commands docker jq gzip sha256sum
[[ ! -e "$output" ]] || fail 'Output directory already exists; export to a new directory'
mkdir -p "$(dirname "$output")"
temporary="$(mktemp -d "$(dirname "$output")/.export.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT
image="t-box-api:$release_id"
docker image inspect "$image" > "$temporary/image-inspect.json"
jq -e 'length == 1 and .[0].Os == "linux" and (.[0].Architecture == "amd64" or .[0].Architecture == "arm64")' "$temporary/image-inspect.json" >/dev/null ||
  fail 'Only a single Linux amd64/arm64 image can be exported'
docker image save "$image" | gzip -n > "$temporary/image.tar.gz"
archive_sha="$(sha256sum "$temporary/image.tar.gz" | cut -d ' ' -f 1)"
size="$(wc -c < "$temporary/image.tar.gz" | tr -d '[:space:]')"
printf '%s  image.tar.gz\n' "$archive_sha" > "$temporary/image.tar.gz.sha256"
jq -n --slurpfile inspect "$temporary/image-inspect.json" \
  --arg release "$release_id" --arg tag "$image" --arg sha "$archive_sha" --argjson size "$size" \
  --arg commit "${GITHUB_SHA:-}" --arg ref "${GITHUB_REF:-}" --arg repository "${GITHUB_REPOSITORY:-}" \
  '{schemaVersion:1, releaseId:$release, image:{tag:$tag,id:$inspect[0][0].Id,os:$inspect[0][0].Os,architecture:$inspect[0][0].Architecture},
    archive:{filename:"image.tar.gz",sha256:$sha,size:$size},
    source:{commit:$commit,ref:$ref,repository:$repository}}' > "$temporary/release.json"
rm "$temporary/image-inspect.json"
verify_archive "$temporary" "$release_id"
mv "$temporary" "$output"
printf 'Exported %s\n' "$release_id"
