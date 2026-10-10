import {
  ApplicationError,
  type ApplicationBackend,
} from "@t-box/app-server-sdk";
import { runCalculation } from "./service.js";
export const calculatorBackend: ApplicationBackend = {
  async lifecycle(request) {
    return {
      status: "completed",
      receipt: {
        appId: request.appId,
        generation: request.generation,
        action: request.action,
      },
    };
  },
  async operation() {
    return null;
  },
  async invoke(request, signal) {
    signal?.throwIfAborted();
    if (request.method !== "calculate")
      throw new ApplicationError("APP_METHOD_NOT_FOUND", "应用方法不存在");
    return runCalculation(request.arguments);
  },
};
