import type { AppRelease } from '@t-box/app-contracts'
import { manifest } from '@t-box/todo-contracts'

export const applicationRelease: AppRelease = {
  appId: 'todo',
  releaseId: `todo-${manifest.version}`,
  manifest,
  protocol: 1,
  kind: 'user',
  platforms: ['web', 'ios', 'android'],
  runtime: {
    type: 'web',
    entryUrl: 'http://localhost:5185/',
    integrity: 'sha256-' + '0'.repeat(64),
  },
  backend: { type: 'local', binding: 'todo' },
  permissions: ['todo.list', 'todo.save'],
  clientTools: [],
  defaultInstalled: false,
}
