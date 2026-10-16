#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 2 ]] || { echo 'Usage: bash upload-runtime.sh RELEASE_ID PACKAGE_DIRECTORY' >&2; exit 1; }
release="$1"
package="$2"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$release" =~ ^sha-[a-f0-9]{40}-run-[1-9][0-9]*-attempt-[1-9][0-9]*$ ]] || fail 'Invalid release ID'
start_services="${PM2_START_SERVICES:-false}"
initialize_admin="${PM2_INIT_ADMIN:-false}"
[[ "$start_services" == true || "$start_services" == false ]] || fail 'PM2_START_SERVICES must be true or false'
[[ "$initialize_admin" == true || "$initialize_admin" == false ]] || fail 'PM2_INIT_ADMIN must be true or false'
[[ "$initialize_admin" == false || "$start_services" == true ]] || fail 'Administrator initialization requires PM2_START_SERVICES=true'
[[ "${PM2_SSH_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail 'Configure PM2_SSH_HOST (hostname or IPv4)'
[[ "${PM2_SSH_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Configure PM2_SSH_USER'
port="${PM2_SSH_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port > 0 && 10#$port <= 65535 )) || fail 'Invalid SSH port'
directory="${PM2_UPLOAD_DIR:-}"
[[ "$directory" =~ ^/[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*$ ]] || fail 'PM2_UPLOAD_DIR must be an absolute path without spaces'
[[ ! "$directory" =~ (^|/)\.\.?(/|$) ]] || fail 'Parent/current path segments are not allowed'
[[ -s "${PM2_SSH_KNOWN_HOSTS_FILE:-}" ]] || fail 'Provide a verified known_hosts file'
options=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$PM2_SSH_KNOWN_HOSTS_FILE" -o ConnectTimeout=15)
if [[ -n "${PM2_SSH_PASSWORD:-}" ]]; then
  command -v sshpass >/dev/null || fail 'Password login requires sshpass on the upload runner'
  [[ "$PM2_SSH_PASSWORD" != *$'\n'* && "$PM2_SSH_PASSWORD" != *$'\r'* ]] || fail 'SSH password must not contain line breaks'
  options+=(-o BatchMode=no -o PubkeyAuthentication=no -o PasswordAuthentication=yes -o PreferredAuthentications=password,keyboard-interactive -o NumberOfPasswordPrompts=1)
  authenticate() {
    # Password goes through an inherited descriptor, never a CLI argument or child env.
    env -u PM2_SSH_PASSWORD sshpass -d 3 "$@" 3<<<"$PM2_SSH_PASSWORD"
  }
else
  [[ -s "${PM2_SSH_KEY_FILE:-}" ]] || fail 'Provide PM2_SSH_PASSWORD or a private key file'
  options+=(-i "$PM2_SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes)
  authenticate() { "$@"; }
fi
for command in ssh scp jq sha256sum gzip; do
  command -v "$command" >/dev/null || fail "Missing command: $command"
done
archive_sha="$(jq -er --arg release "$release" '
  select(.format=="tbox-pm2-v1" and .releaseId==$release and .platform=="linux" and
    (.architecture=="x64" or .architecture=="arm64") and .archive.filename=="runtime.tar.gz") |
  .archive.sha256 | select(type=="string" and test("^[a-f0-9]{64}$"))
' "$package/release.json")" || fail 'Invalid Linux runtime manifest'
architecture="$(jq -r '.architecture' "$package/release.json")"
printf '%s  runtime.tar.gz\n' "$archive_sha" | cmp - "$package/runtime.tar.gz.sha256" >/dev/null || fail 'Checksum metadata mismatch'
(cd "$package" && sha256sum --check --status runtime.tar.gz.sha256) || fail 'Local archive checksum mismatch'
gzip -t "$package/runtime.tar.gz"
host="$PM2_SSH_USER@$PM2_SSH_HOST"
# All remote arguments are validated simple tokens; no untrusted manifest is sourced.
authenticate ssh "${options[@]}" -p "$port" "$host" bash -s -- "$directory" "$release" <<'REMOTE'
set -Eeuo pipefail
umask 077
root="$1"; release="$2"
test ! -e "$root/releases/$release"
test ! -L "$root/releases/$release"
mkdir -p "$root/incoming" "$root/releases"
mkdir "$root/incoming/$release"
REMOTE
authenticate scp "${options[@]}" -P "$port" "$package/runtime.tar.gz" "$package/runtime.tar.gz.sha256" "$package/release.json" "$host:$directory/incoming/$release/"
authenticate ssh "${options[@]}" -p "$port" "$host" bash -s -- "$directory" "$release" "$archive_sha" "$architecture" "$start_services" "$initialize_admin" <<'REMOTE'
set -Eeuo pipefail
umask 077
root="$1"; release="$2"; expected="$3"; architecture="$4"; start_services="$5"; initialize_admin="$6"
test "$(uname -s)" = Linux
case "$(uname -m)/$architecture" in x86_64/x64|aarch64/arm64|arm64/arm64) ;; *) echo 'Server architecture mismatch' >&2; exit 1 ;; esac
cd "$root/incoming/$release"
printf '%s  runtime.tar.gz\n' "$expected" | cmp - runtime.tar.gz.sha256 >/dev/null
sha256sum --check runtime.tar.gz.sha256
gzip -t runtime.tar.gz
# CI emits only relative names. Keep extraction in a new private version directory.
tar -tzf runtime.tar.gz > archive-files.txt
if grep -Eq '(^/|(^|/)\.\.(/|$))' archive-files.txt; then
  echo 'Unsafe archive entry path' >&2; exit 1
fi
test ! -e "$root/releases/$release"
test ! -L "$root/releases/$release"
staging="$root/releases/.$release.staging"
mkdir "$staging"
tar --no-same-owner --no-same-permissions -xzf runtime.tar.gz -C "$staging"
test -f "$staging/api/dist/server.js"
test -d "$staging/api/node_modules"
test -f "$staging/control/ecosystem.config.cjs"
test -f "$staging/release-info.json"
cp release.json "$staging/release.json"
mv "$staging" "$root/releases/$release"
printf 'Uploaded and verified: %s/releases/%s\n' "$root" "$release"
if [[ "$start_services" == true ]]; then
  args=()
  if [[ "$initialize_admin" == true ]]; then args+=(--init-admin); fi
  node "$root/releases/$release/control/start-release.mjs" "${args[@]}"
fi
REMOTE
