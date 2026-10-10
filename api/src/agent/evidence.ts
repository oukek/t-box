import type { ToolResult } from "@t-box/shared";
/** A bounded, explicitly marked projection prevents duplicating large receipts in system instructions.
 * Actual success checks, journals and history always use the full result. */
export function receiptEvidence(result?: ToolResult, bytes = 1024): unknown {
  if (!result) return { unavailable: true, note: "缺少回执，不能视为成功" };
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, "utf8") <= bytes) return result;
  const preview = new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.from(json, "utf8").subarray(0, bytes),
  );
  return {
    ok: result.ok,
    preview,
    truncated: true,
    note: "此处为有长度限制的回执预览；完整结果保留在执行记录和会话上下文，不得据预览臆造遗漏信息。",
  };
}
