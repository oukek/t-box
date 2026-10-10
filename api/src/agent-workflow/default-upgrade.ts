import type { AgentWorkflowPrompts } from '@t-box/shared'
import { createHash } from 'node:crypto'
import { defaultWorkflowPrompts } from './defaults.js'

// Fingerprint of the original, unedited four built-in prompts. Custom configurations
// and existing task snapshots must retain their exact text and revision.
const legacyDefaultsHash =
  'ef8ea0cf631508cd14fcc7d1d23fd86cce9f932e5859e8f70c0ecc8f67511f91'
export function upgradeDefaultWorkflow(
  value: unknown,
): AgentWorkflowPrompts | undefined {
  let prompts: unknown
  try {
    prompts = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return
  }
  if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) {
    return
  }
  const hash = createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(prompts).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex')
  if (hash !== legacyDefaultsHash) {
    return
  }
  return structuredClone(defaultWorkflowPrompts)
}
