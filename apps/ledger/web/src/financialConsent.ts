import { reactive, readonly } from "vue";
import { bookState } from "./books/bookStore";
const state = reactive<{
  title: string;
  ledgerId: string;
  ledgerName: string;
  lines: string[];
  open: boolean;
}>({ title: "", ledgerId: "", ledgerName: "", lines: [], open: false });
let settle: ((value: { approved: boolean }) => void) | undefined;
export const financialConsent = readonly(state);
export function requestFinancialConsent(
  value: unknown,
): Promise<{ approved: boolean }> {
  if (settle) throw new Error("已有一项操作等待确认。");
  if (!value || typeof value !== "object") throw new Error("确认内容无效。");
  const proposal = value as typeof state;
  if (
    typeof proposal.ledgerId !== "string" ||
    proposal.ledgerId !== bookState.selectedId ||
    typeof proposal.ledgerName !== "string" ||
    typeof proposal.title !== "string" ||
    !Array.isArray(proposal.lines) ||
    proposal.lines.length > 220 ||
    proposal.lines.some(
      (line) => typeof line !== "string" || line.length > 4000,
    )
  )
    throw new Error("确认内容无效或账本已切换。");
  Object.assign(state, {
    title: proposal.title,
    ledgerId: proposal.ledgerId,
    ledgerName: proposal.ledgerName,
    lines: proposal.lines,
    open: true,
  });
  return new Promise((resolve) => {
    settle = resolve;
  });
}
export function resolveFinancialConsent(approved: boolean) {
  const finish = settle;
  settle = undefined;
  state.open = false;
  finish?.({ approved });
}
