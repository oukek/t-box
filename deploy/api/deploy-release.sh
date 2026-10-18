#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$script_dir/release-common.sh"
[[ $# == 1 || $# == 2 ]] || fail 'Usage: bash deploy-release.sh RELEASE_ID [--init|--rollback]'
release_id="$1"
mode="${2:-update}"
validate_release_id "$release_id"
case "$mode" in update|--init|--rollback) ;; *) fail 'Unknown deployment mode' ;; esac
need_commands docker jq gzip sha256sum flock awk
[[ -f "$script_dir/.env" && -f "$script_dir/compose.yaml" ]] || fail 'Prepare .env and compose.yaml first'
cd "$script_dir"
exec 8>"$script_dir/.deploy.lock"
flock -n 8 || fail 'Another deployment is already running'
temporary_env=''
trap 'if [[ -n "$temporary_env" ]]; then rm -f -- "$temporary_env"; fi' EXIT
trap 'printf "Deployment failed. Inspect container status, .env and current-release before retrying; database initialization is never automatically reverted.\n" >&2' ERR
bash "$script_dir/download-release.sh" "$release_id"
export API_IMAGE="t-box-api:$release_id"
compose() { docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" -f "$script_dir/compose.yaml" "$@"; }
compose config --quiet
compose run --rm --no-deps --pull never api node --input-type=module -e 'import("./dist/config.js").then(({resourceStorageSettings})=>resourceStorageSettings())'
if [[ "$mode" != '--rollback' ]]; then
  compose run --rm --no-deps --pull never api node dist/init-db.js --check
fi
# No application downtime until archive verification/import and config validation succeed.
compose stop api
if [[ "$mode" != '--rollback' ]]; then
  compose run --rm --no-deps --pull never api node dist/init-db.js
fi
if [[ "$mode" == '--init' ]]; then
  compose run --rm --no-deps --pull never api node dist/admin/bootstrap.js
fi
# Rollback only switches code. The operator must establish database compatibility first.
compose up -d --pull never --wait --wait-timeout 120 --remove-orphans api
temporary_env="$(mktemp "$script_dir/.env.XXXXXX")"
awk -v image="$API_IMAGE" '
  /^[[:space:]]*API_IMAGE[[:space:]]*=/ { if (!written++) print "API_IMAGE=" image; next }
  { print }
  END { if (!written) print "API_IMAGE=" image }
' "$script_dir/.env" > "$temporary_env"
chmod 600 "$temporary_env"
mv "$temporary_env" "$script_dir/.env"
temporary_env=''
if [[ -f current-release && "$(cat current-release)" != "$release_id" ]]; then
  cp current-release previous-release
fi
printf '%s\n' "$release_id" > .current-release.tmp
mv .current-release.tmp current-release
printf 'Deployment healthy: %s\n' "$API_IMAGE"
