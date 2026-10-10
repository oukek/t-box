import { reactive, readonly } from "vue";
import type { ConversationSummary } from "@t-box/shared";
import { request } from "../../core/network";
import { identity } from "../../core/session";
const state = reactive({
  items: [] as ConversationSummary[],
  loading: false,
  error: "",
});
export const conversationHistory = readonly(state);
let controller: AbortController | undefined;
export async function refreshConversationHistory() {
  controller?.abort();
  const current = (controller = new AbortController()),
    userId = identity.user?.id;
  if (!userId) {
    resetConversationHistory();
    return;
  }
  state.loading = true;
  state.error = "";
  try {
    const result = await request<{ data: ConversationSummary[] }>(
      "/conversations",
      { signal: current.signal },
    );
    if (!current.signal.aborted && identity.user?.id === userId)
      state.items = result.data;
  } catch (cause) {
    if (!current.signal.aborted && identity.user?.id === userId)
      state.error = cause instanceof Error ? cause.message : "读取会话历史失败";
  } finally {
    if (controller === current) state.loading = false;
  }
}
export function resetConversationHistory() {
  controller?.abort();
  controller = undefined;
  state.items = [];
  state.loading = false;
  state.error = "";
}
