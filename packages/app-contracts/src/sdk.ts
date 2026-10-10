import type { AppPlatform } from "./index.js";

/** Additive SDK protocol; executable release protocol remains unchanged. */
export const APP_SDK_VERSION = 1 as const;
export interface ApplicationContext {
  sdkVersion: typeof APP_SDK_VERSION;
  appId: string;
  releaseId: string;
  generation: number;
  subject: string;
  platform: AppPlatform;
  runtime: "shell" | "web";
  params: Readonly<Record<string, string>>;
  permissions: readonly string[];
  capabilities: readonly HostMethod[];
}
export interface ApplicationSession {
  status: "restoring" | "signed_in" | "signed_out";
  /** App-scoped identity. Never the host account ID or bearer token. */
  subject: string | null;
  profile?: { nickname: string };
}
export type HostMethod =
  | "runtime.context"
  | "auth.session"
  | "api.invoke"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "navigation.back"
  | "navigation.open"
  | "events.subscribe"
  | "events.unsubscribe";
export interface ApplicationBridgeError {
  code: string;
  message: string;
  status?: number;
}
export interface ApplicationBridgeEvent {
  type: "event";
  name: "auth.changed" | "runtime.closed" | "app.event" | "app.event.error";
  data: unknown;
}
