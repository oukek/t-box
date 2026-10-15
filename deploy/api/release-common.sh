#!/usr/bin/env bash
# Shared by CI export/upload and server download/deployment.

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need_commands() {
  local command
  for command in "$@"; do
    command -v "$command" >/dev/null 2>&1 || fail "Required command missing: $command"
  done
}
validate_release_id() {
  [[ "$1" =~ ^sha-[a-f0-9]{40}-run-[1-9][0-9]*-attempt-[1-9][0-9]*$ ]] ||
    fail 'Invalid release ID; use the exact ID from the Actions summary'
}
load_oss_settings() {
  # This file is operator-owned shell configuration, never an OSS-provided manifest.
  if [[ -f "$script_dir/oss.env" ]]; then
    set -a
    source "$script_dir/oss.env"
    set +a
  fi
  OSS_PREFIX="${OSS_PREFIX:-t-box/api}"
  [[ "${OSS_BUCKET:-}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail 'Set OSS_BUCKET'
  [[ "$OSS_PREFIX" =~ ^[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$ ]] || fail 'Invalid OSS_PREFIX'
}
validate_manifest() {
  local folder="$1" release="$2"
  jq -e --arg release "$release" '
    .schemaVersion == 1 and .releaseId == $release and
    .image.tag == ("t-box-api:" + $release) and
    (.image.id | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    .image.os == "linux" and (.image.architecture == "amd64" or .image.architecture == "arm64") and
    .archive.filename == "image.tar.gz" and
    (.archive.sha256 | type == "string" and test("^[a-f0-9]{64}$")) and
    (.archive.size | type == "number" and . > 0 and . == floor)
  ' "$folder/release.json" >/dev/null || fail 'Invalid release manifest'
}
verify_archive() {
  local folder="$1" release="$2" expected size actual_size
  validate_manifest "$folder" "$release"
  expected="$(jq -r '.archive.sha256' "$folder/release.json")"
  size="$(jq -r '.archive.size' "$folder/release.json")"
  actual_size="$(wc -c < "$folder/image.tar.gz" | tr -d '[:space:]')"
  [[ "$actual_size" == "$size" ]] || fail 'Image archive size mismatch'
  printf '%s  image.tar.gz\n' "$expected" | cmp - "$folder/image.tar.gz.sha256" >/dev/null ||
    fail 'Checksum file differs from release manifest'
  (cd "$folder" && sha256sum --check --status image.tar.gz.sha256) || fail 'Image SHA-256 verification failed'
  gzip -t "$folder/image.tar.gz" || fail 'Invalid gzip archive'
}
