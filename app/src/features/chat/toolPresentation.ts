import type { ToolCallView } from '@t-box/shared'

/**
 * Skill activation is internal preparation. Keep failures visible so a missing
 * capability is not silently hidden; execution/audit records remain untouched.
 */
export function isVisibleConversationTool(
  tool: Pick<ToolCallView, 'name' | 'status'>,
) {
  return tool.name !== 'skill_activate' || tool.status === 'failed'
}
