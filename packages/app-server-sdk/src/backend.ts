import type {
  LifecycleRequest,
  LifecycleReceipt,
  BackendInvocation,
} from "@t-box/app-contracts";
export interface ApplicationBackend {
  lifecycle(request: LifecycleRequest): Promise<LifecycleReceipt>;
  operation(request: LifecycleRequest): Promise<LifecycleReceipt | null>;
  invoke(request: BackendInvocation, signal?: AbortSignal): Promise<unknown>;
}
/** Portable HTTP boundary for independently deployed services. The backend must persist operation receipts and generation fences in its own database. */
export function createApplicationBackendHandler(options: {
  credential: string;
  appId: string;
  backend: ApplicationBackend;
}) {
  if (!options.credential) throw new Error("Service credential is required");
  return async (request: Request): Promise<Response> => {
    if (
      request.method !== "POST" ||
      request.headers.get("authorization") !== `Bearer ${options.credential}`
    )
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const path = new URL(request.url).pathname;
    if (!["/lifecycle/ensure", "/lifecycle/status", "/invoke"].includes(path))
      return Response.json({ error: "Not found" }, { status: 404 });
    const body = await request.text();
    if (body.length > 64000)
      return Response.json({ error: "Too large" }, { status: 413 });
    try {
      const value = JSON.parse(body);
      if (
        value.appId !== options.appId ||
        typeof value.subject !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.subject) ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 1 ||
        typeof value.releaseId !== "string"
      )
        return Response.json({ error: "Invalid invocation" }, { status: 400 });
      if (path === "/invoke") {
        if (
          typeof value.invocationId !== "string" ||
          typeof value.method !== "string"
        )
          return Response.json(
            { error: "Invalid invocation" },
            { status: 400 },
          );
        return Response.json(
          await options.backend.invoke(value, request.signal),
        );
      }
      if (
        typeof value.operationId !== "string" ||
        !["install", "update", "uninstall"].includes(value.action)
      )
        return Response.json({ error: "Invalid lifecycle" }, { status: 400 });
      return Response.json(
        path === "/lifecycle/status"
          ? await options.backend.operation(value)
          : await options.backend.lifecycle(value),
      );
    } catch {
      return Response.json(
        { error: "Application service failed" },
        { status: 500 },
      );
    }
  };
}
