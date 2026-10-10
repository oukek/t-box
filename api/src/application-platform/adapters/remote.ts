import type {
  LifecycleRequest,
  LifecycleReceipt,
  BackendInvocation,
} from "@t-box/app-contracts";
import { ApiError } from "@t-box/server-foundation/errors";
import type { ApplicationBackend } from "./contracts.js";
/** Bound by trusted deployment configuration. Credentials never enter catalog or model prompts. */
export class RemoteApplicationBackend implements ApplicationBackend {
  private readonly base: URL;
  constructor(
    baseUrl: string,
    private readonly credential: string,
    private readonly timeout = 5000,
  ) {
    this.base = new URL(baseUrl);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      (this.base.protocol !== "https:" &&
        !(
          this.base.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname)
        ))
    )
      throw new Error(
        "Remote applications require HTTPS or loopback development endpoint",
      );
    if (!credential) throw new Error("Remote service credential is required");
  }
  private async request(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, this.base), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.credential}`,
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)])
        : AbortSignal.timeout(this.timeout),
    });
    if (!response.ok)
      throw new ApiError(502, "APP_BACKEND_UNAVAILABLE", "应用后端暂时不可用");
    const text = await response.text();
    if (text.length > 256_000)
      throw new Error("Application response too large");
    return JSON.parse(text);
  }
  private receipt(value: unknown): LifecycleReceipt | null {
    if (value === null) return null;
    if (!value || typeof value !== "object")
      throw new Error("Invalid lifecycle receipt");
    const r = value as LifecycleReceipt;
    if (r.status === "pending") return { status: "pending" };
    if (
      r.status === "completed" &&
      r.receipt &&
      typeof r.receipt === "object" &&
      !Array.isArray(r.receipt)
    )
      return r;
    if (r.status === "rejected" && typeof r.message === "string")
      return { status: "rejected", message: r.message.slice(0, 300) };
    throw new Error("Invalid lifecycle receipt");
  }
  async lifecycle(request: LifecycleRequest) {
    return (
      this.receipt(await this.request("lifecycle/ensure", request)) ?? {
        status: "pending" as const,
      }
    );
  }
  async operation(request: LifecycleRequest) {
    return this.receipt(await this.request("lifecycle/status", request));
  }
  async invoke(request: BackendInvocation, signal?: AbortSignal) {
    return this.request("invoke", request, signal);
  }
}
