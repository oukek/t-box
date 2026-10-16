#!/usr/bin/env bash
set -euo pipefail
destination="${RUNNER_TEMP:?}/tbox-ossutil"
mkdir -p "$destination/bin"
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 180 \
  https://gosspublic.alicdn.com/ossutil/v2/2.4.0/ossutil-2.4.0-linux-amd64.zip -o "$destination/ossutil.zip"
printf '85edf66b2fb7238f5c7e25cab820cf29312319fe4935b7c86a6b8485eb434f3c  %s\n' "$destination/ossutil.zip" | sha256sum --check
unzip -q -o "$destination/ossutil.zip" -d "$destination/unpacked"
install -m 755 "$destination/unpacked/ossutil-2.4.0-linux-amd64/ossutil" "$destination/bin/ossutil"
printf '%s\n' "$destination/bin" >> "${GITHUB_PATH:?}"
