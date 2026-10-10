import { identity, setSession } from "./session";
import { createRequestId } from "./identifiers";
import { RequestError } from "@t-box/app-shell-sdk";
export { RequestError } from "@t-box/app-shell-sdk";
const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const apiBase = (configuredBase || "/api/v1").replace(/\/+$/, "");

export const configurationError =
  !import.meta.env.DEV &&
  window.Capacitor?.isNativePlatform?.() &&
  !configuredBase
    ? "应用尚未配置服务地址。请设置 VITE_API_BASE_URL 后重新打包应用。"
    : "";

export async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  if (configurationError) throw new Error(configurationError);
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const externalSignal = options.signal;
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(identity.token
          ? { Authorization: `Bearer ${identity.token}` }
          : {}),
        ...(["POST", "PATCH", "DELETE"].includes(options.method ?? "")
          ? { "Idempotency-Key": createRequestId() }
          : {}),
        ...(options.body && !(options.body instanceof Blob)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("服务返回了无法读取的数据，请稍后重试。");
    }
    if (!response.ok) {
      const errorBody = body as {
        error?: {
          message?: string;
          code?: string;
          details?: Record<string, string>;
        };
      };
      if (response.status === 401 && path !== "/auth/login") setSession(null);
      throw new RequestError(
        errorBody.error?.details
          ? Object.values(errorBody.error.details).join("；")
          : errorBody.error?.message || `请求失败（${response.status}）`,
        response.status,
        errorBody.error?.code ?? "UNKNOWN",
      );
    }
    return body as T;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "服务响应超时，请稍后重试。保存或删除前可先刷新账单，确认上一次操作结果。",
      );
    if (controller.signal.aborted) throw error;
    if (error instanceof TypeError)
      throw new Error("暂时无法连接服务，请检查网络或稍后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export function chatWebSocketUrl(path = "/chat/ws"): string {
  if (configurationError) throw new Error(configurationError);
  const url = new URL(`${apiBase}${path}`, window.location.href);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("请配置有效的 HTTP 或 HTTPS 服务地址。");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
