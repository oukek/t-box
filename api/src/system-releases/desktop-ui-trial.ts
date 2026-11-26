import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import JSZip from 'jszip'
import { SystemDesktopCandidate } from '../db/records/system-versions.js'
import { ErrorCode } from '../error-codes.js'
import { desktopStorage } from './desktop-artifacts.js'

const launcher = `#!/bin/zsh
set -eu
cd "$(dirname "$0")"
if /usr/bin/pgrep -x tbox-desktop >/dev/null; then
  echo '请先退出正在运行的方舟，再双击启动体验版。'
  exit 1
fi
trial_dir=$(/usr/bin/mktemp -d)
trap '/bin/rm -rf "$trial_dir"' EXIT
trial_profile="$trial_dir/profile"
system_dir="$trial_profile/Library/Application Support/cn.tboxos.desktop/system"
/bin/mkdir -p "$system_dir"
/bin/cp resources/state.json "$system_dir/state.json"
digest=$(/usr/bin/shasum -a 256 resources/ui.json | /usr/bin/cut -d ' ' -f 1)
/bin/cp resources/ui.json "$system_dir/$digest"
/usr/bin/tar -xzf resources/core.app.tar.gz -C "$trial_dir"
/usr/bin/open -n -W --env "HOME=$trial_profile" "$trial_dir/T方舟.app"
`

export async function desktopUiTrial(db: DataSource, build: string, storage?: ReturnType<typeof desktopStorage>) {
  const candidate = await db.manager.findOneBy(SystemDesktopCandidate, { build, kind: 'ui', state: 'pending' })
  const live = await db.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
  if (!candidate || !live || candidate.base !== live.build || candidate.core.digest !== live.core.digest) {
    throw ErrorCode.SYSTEM_VERSION_CONFLICT('候选或线上基线已变化，请刷新列表并核对构建')
  }
  const store = storage ?? desktopStorage()
  const [core, ui] = await Promise.all([store.read('core', live.core), store.read('ui', candidate.ui)])
  // Registration authenticated both immutable artifacts. Bind the download to those exact bytes.
  if (createHash('sha256').update(core).digest('hex') !== live.core.digest ||
    createHash('sha256').update(ui).digest('hex') !== candidate.ui.digest) {
    throw ErrorCode.INVALID_APP_BUILD('体验包制品摘要不匹配')
  }
  const archive = new JSZip()
  const resources = archive.folder('resources')!
  resources.file('core.app.tar.gz', core)
  resources.file('ui.json', ui)
  const { version, signature, digest } = candidate.ui
  resources.file('state.json', JSON.stringify({
    active: { version, signature, digest },
    last_release: null,
    downloading: null,
    pending: null,
    attempted: false,
    message: '',
  }))
  archive.file('启动体验版.command', launcher, { unixPermissions: 0o100755 })
  return new Readable().wrap(archive.generateNodeStream({ platform: 'UNIX', streamFiles: true }))
}
