import {
  APP_PROTOCOL,
  APP_SDK_VERSION,
  type RuntimeDescriptor,
  type BridgeRequest,
  type BridgeResponse,
  type HostMethod,
} from "@t-box/app-contracts";
import { request } from "../network";
import { createHostTransport } from "./sdkHost";
import { AppSdkError } from "@t-box/app-sdk";
import { identity } from "../session";
export interface AppConnection {
  invoke(name: string, args: unknown): Promise<unknown>;
  close(): void;
}
// Vite may replace the module while an iframe remains mounted. Keep its live channel
// available to the new tool dispatcher instead of creating a second empty registry.
const connections: Map<
  string,
  { promise: Promise<AppConnection>; close(): void }
> = import.meta.hot?.data.connections ?? new Map();
if (import.meta.hot) import.meta.hot.data.connections = connections;
export async function descriptor(appId: string) {
  const platform = window.Capacitor?.isNativePlatform?.()
    ? window.Capacitor.getPlatform?.()
    : "web";
  const result = await request<{ data: RuntimeDescriptor }>(
    `/applications/${encodeURIComponent(appId)}/runtime?platform=${platform || "web"}`,
  );
  const entry = new URL(result.data.entryUrl);
  if (
    result.data.protocol !== APP_PROTOCOL ||
    result.data.appId !== appId ||
    entry.origin !== result.data.origin ||
    !["http:", "https:"].includes(entry.protocol) ||
    entry.username ||
    entry.password
  )
    throw new Error("应用运行协议或来源无效");
  // Local Vite live reload follows the host's LAN address. Packaged production always uses the registered HTTPS origin.
  if (
    import.meta.env.DEV &&
    new URL(result.data.entryUrl).hostname === "localhost"
  ) {
    const url = new URL(result.data.entryUrl);
    url.hostname = location.hostname;
    result.data.entryUrl = url.href;
    result.data.origin = url.origin;
  }
  if (result.data.origin === location.origin)
    throw new Error("独立应用需要使用单独的来源地址");
  return result.data;
}
export function connectFrame(
  frame: HTMLIFrameElement,
  runtime: RuntimeDescriptor,
  params: Record<string, string>,
) {
  const channel = new MessageChannel(),
    nonce = crypto.randomUUID(),
    userId = identity.user?.id;
  const pending = new Map<
    string,
    {
      resolve(v: unknown): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false,
    ready = false,
    resolveReady!: (connection: AppConnection) => void,
    rejectReady!: (error: Error) => void;
  const promise = new Promise<AppConnection>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A failed load can reject before an AI tool waits for it. The page still displays the actual error.
  void promise.catch(() => {});
  const transport = createHostTransport({
    appId: runtime.appId,
    expected: runtime,
    params,
  });
  const stopEvents = transport.listen((event) => {
    if (!closed) channel.port1.postMessage(event);
    if (event.name === "runtime.closed") close("应用会话已结束");
  });
  const timer = setTimeout(() => close("应用连接超时，请重试"), 15000);
  function close(reason = "应用已关闭") {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    channel.port1.postMessage({
      type: "event",
      name: "runtime.closed",
      data: { code: "APP_CLOSED", message: reason },
    });
    stopEvents();
    transport.close();
    channel.port1.close();
    channel.port2.close();
    rejectReady(new Error(reason));
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
    if (connections.get(runtime.appId)?.promise === promise)
      connections.delete(runtime.appId);
  }
  const current = async () => {
    if (closed || identity.user?.id !== userId)
      throw new Error("应用会话已结束");
    const latest = await descriptor(runtime.appId);
    if (closed || identity.user?.id !== userId)
      throw new Error("应用会话已结束");
    if (
      latest.releaseId !== runtime.releaseId ||
      latest.generation !== runtime.generation
    ) {
      close("应用安装状态已改变");
      throw new Error("请重新打开应用");
    }
  };
  channel.port1.onmessage = async (event: MessageEvent) => {
    const data = event.data;
    if (closed || !data || identity.user?.id !== userId) return;
    if (data.type === "ready") {
      if (
        ready ||
        data.nonce !== nonce ||
        !Array.isArray(data.tools) ||
        JSON.stringify([...data.tools].sort()) !==
          JSON.stringify([...runtime.clientTools].sort())
      ) {
        close("应用工具声明不匹配");
        return;
      }
      ready = true;
      clearTimeout(timer);
      resolveReady({
        close: () => close(),
        invoke: async (name, args) => {
          await current();
          if (!runtime.clientTools.includes(name))
            throw new Error("未授权的应用工具");
          return new Promise((resolve, reject) => {
            const id = crypto.randomUUID(),
              timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error("应用工具执行超时"));
              }, 15000);
            pending.set(id, { resolve, reject, timer: timeout });
            channel.port1.postMessage({
              type: "request",
              id,
              method: name,
              args,
            });
          });
        },
      });
      return;
    }
    if (typeof data.id !== "string" || data.id.length > 80) return;
    if (!ready && data.type !== "request") return;
    if (data.type === "response") {
      const p = pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(data.id);
      try {
        await current();
      } catch (e) {
        p.reject(e instanceof Error ? e : new Error("应用授权已失效"));
        return;
      }
      data.ok === true
        ? p.resolve(data.data)
        : p.reject(
            new Error(
              typeof data.error === "string"
                ? data.error.slice(0, 300)
                : "应用执行失败",
            ),
          );
      return;
    }
    if (data.type !== "request") return;
    const r = data as BridgeRequest;
    try {
      if (JSON.stringify(r.args).length > 64000)
        throw new Error("应用请求内容过大");
      const value = await transport.call(r.method as HostMethod, r.args, {
        idempotencyKey: r.options?.idempotencyKey ?? r.id,
        timeoutMs: r.options?.timeoutMs,
      });
      if (!closed)
        channel.port1.postMessage({
          type: "response",
          id: r.id,
          ok: true,
          data: value,
        } satisfies BridgeResponse);
    } catch (e) {
      if (!closed)
        channel.port1.postMessage({
          type: "response",
          id: r.id,
          ok: false,
          error: e instanceof Error ? e.message : "请求失败",
          failure: {
            code: AppSdkError.from(e).code,
            message: AppSdkError.from(e).message,
            status: AppSdkError.from(e).status,
          },
        } satisfies BridgeResponse);
    }
  };
  connections.get(runtime.appId)?.close();
  connections.set(runtime.appId, { promise, close: () => close() });
  frame.contentWindow!.postMessage(
    {
      type: "tbox.connect",
      protocol: APP_PROTOCOL,
      sdkVersion: APP_SDK_VERSION,
      nonce,
      context: {
        appId: runtime.appId,
        releaseId: runtime.releaseId,
        generation: runtime.generation,
        subject: runtime.subject,
        params: { ...params },
      },
    },
    runtime.origin,
    [channel.port2],
  );
  return { promise, close: () => close() };
}
export async function invokeApplicationTool(
  value: unknown,
  open: (args: unknown) => Promise<unknown>,
) {
  if (!value || typeof value !== "object") throw new Error("应用工具参数无效");
  const a = value as {
    appId: string;
    releaseId: string;
    generation: number;
    tool: string;
    arguments: unknown;
  };
  if (
    Object.keys(a).some(
      (k) =>
        !["appId", "releaseId", "generation", "tool", "arguments"].includes(k),
    ) ||
    typeof a.appId !== "string" ||
    typeof a.tool !== "string"
  )
    throw new Error("应用工具参数无效");
  const runtime = await descriptor(a.appId);
  if (
    runtime.releaseId !== a.releaseId ||
    runtime.generation !== a.generation ||
    !runtime.clientTools.includes(a.tool)
  )
    throw new Error("应用工具授权已过期");
  await open({ appId: a.appId });
  // Rendering creates the iframe before its load callback establishes the channel.
  const started = Date.now();
  while (!connections.has(a.appId) && Date.now() - started < 15000)
    await new Promise((r) => setTimeout(r, 30));
  const connection = connections.get(a.appId);
  if (!connection) throw new Error("应用尚未打开");
  return (await connection.promise).invoke(a.tool, a.arguments);
}
export function closeApplicationRuntimes() {
  for (const connection of connections.values()) connection.close();
  connections.clear();
}
