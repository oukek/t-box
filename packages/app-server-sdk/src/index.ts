export * from "./contracts.js";
export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export * from "./schema.js";
export type {
  LifecycleRequest,
  LifecycleReceipt,
  BackendInvocation,
} from "@t-box/app-contracts";
export * from "./backend.js";
export * from "./remote-tools.js";
