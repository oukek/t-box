import { ApiError } from "@t-box/server-foundation/errors";
import { CHAT_LIMITS, type ToolResult } from "@t-box/shared";
import type { ChatSession, SessionRun } from "../chat/session.js";
import type { ClientInteraction } from "./contracts.js";

/** Pause at a resumable boundary; never feed an absent client's decision to the model. */
export function requireClient(session: ChatSession, run: SessionRun) {
  run.abort.signal.throwIfAborted();
  if (!session.owner || !session.send) {
    run.abort.abort("CLIENT_REQUIRED");
    run.abort.signal.throwIfAborted();
  }
}
const deferred: ToolResult = {
  ok: false,
  error: {
    code: "CLIENT_SYNC_DEFERRED",
    message: "数据已保存，设备同步将在重新打开应用后进行",
  },
};

/** Every request has a fresh connection-bound nonce. Optional requests cannot grant consent. */
export function requestClient(
  session: ChatSession,
  run: SessionRun,
  callId: string,
  request: ClientInteraction,
  defaultTimeoutMs?: number,
  onWait?: () => void,
): Promise<ToolResult> {
  if (run.pending)
    throw new ApiError(
      409,
      "INTERACTION_IN_PROGRESS",
      "已有一项客户端操作正在等待处理",
    );
  run.abort.signal.throwIfAborted();
  if (request.optional && (!session.owner || !session.send))
    return Promise.resolve(deferred);
  requireClient(session, run);
  if (
    session.clientCapabilities &&
    !session.clientCapabilities.includes(request.name)
  ) {
    if (request.optional) return Promise.resolve(deferred);
    throw new ApiError(
      409,
      "CLIENT_CAPABILITY_UNAVAILABLE",
      "当前客户端不支持此操作，请更新应用",
    );
  }
  run.view.status = "waiting_client";
  onWait?.();
  requireClient(session, run);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      run.abort.signal.removeEventListener("abort", abort);
      run.pending = undefined;
      run.view.status = "running";
    };
    const finish = (value: ToolResult) => {
      if (settled) return;
      cleanup();
      resolve(value);
    };
    const abort = () => {
      if (settled) return;
      cleanup();
      reject(run.abort.signal.reason);
    };
    const disconnect = () => {
      if (request.optional) finish(deferred);
      else run.abort.abort("CLIENT_REQUIRED");
    };
    const timeout = setTimeout(
      () => {
        if (request.optional)
          finish({
            ok: false,
            error: {
              code: "CLIENT_TOOL_TIMEOUT",
              message: "设备同步未及时完成",
            },
          });
        else run.abort.abort("CLIENT_REQUIRED");
      },
      request.timeoutMs ?? defaultTimeoutMs ?? CHAT_LIMITS.clientToolTimeoutMs,
    );
    run.pending = { callId, owner: session.owner!, settle: finish, disconnect };
    run.abort.signal.addEventListener("abort", abort, { once: true });
    if (run.abort.signal.aborted) abort();
    else
      session.send?.({
        type: "tool.request",
        runId: run.view.id,
        callId,
        name: request.name,
        arguments: request.arguments,
      });
  });
}
