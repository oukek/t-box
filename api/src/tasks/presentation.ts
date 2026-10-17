import type { TaskToolRecord } from '@t-box/shared'

/** User task history needs status, not internal tool receipts/instructions. */
export function publicTaskTool(tool: TaskToolRecord, title: string) {
  return {
    callId: tool.callId,
    name: tool.name,
    agentId: tool.agentId,
    effect: tool.effect,
    status: tool.status,
    title,
    ...(tool.result
      ? { result: tool.result.ok
          ? { ok: true as const, data: {} }
          : { ok: false as const, error: { code: 'TOOL_FAILED', message: '工具处理未完成，请查看会话提示' } } }
      : {}),
  }
}
