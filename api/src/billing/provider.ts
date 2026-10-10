import { estimateInputTokens } from "../agent/context.js";
import type { ModelPrices } from "@t-box/shared";
import type { ChatProvider, ProviderInput } from "../chat/provider.js";
import { BillingService } from "./service.js";
import { tokenFee, money } from "./money.js";
import { ApiError } from "@t-box/server-foundation/errors";
export class MeteredChatProvider implements ChatProvider {
  readonly mode;
  readonly configurationKey;
  readonly contextPolicy;
  readonly maxOutputTokens;
  constructor(
    private readonly provider: ChatProvider,
    private readonly billing: BillingService,
    private readonly modelId: string,
    private readonly prices: ModelPrices,
  ) {
    this.contextPolicy = provider.contextPolicy;
    this.maxOutputTokens = provider.maxOutputTokens;
    this.mode = provider.mode;
    this.configurationKey = provider.configurationKey;
  }
  async next(input: ProviderInput) {
    return this.meter(
      input,
      this.provider.next.bind(this.provider),
      input.execution?.purpose ?? "response",
    );
  }
  async compact(input: ProviderInput) {
    if (!this.provider.compact)
      throw new ApiError(409, "COMPACTION_DISABLED", "服务商不支持上下文压缩");
    return this.meter(
      input,
      this.provider.compact.bind(this.provider),
      "compaction",
    );
  }
  async countInputTokens(input: ProviderInput) {
    if (!this.provider.countInputTokens)
      throw new ApiError(
        409,
        "TOKEN_COUNT_UNSUPPORTED",
        "服务商不支持输入 token 计数，请关闭此能力",
      );
    return this.provider.countInputTokens(input);
  }
  async summarize(input: ProviderInput) {
    if (!this.provider.summarize)
      throw new ApiError(409, "SUMMARY_UNSUPPORTED", "服务商不支持摘要压缩");
    return this.meter(
      input,
      this.provider.summarize.bind(this.provider),
      "compaction",
    );
  }
  private async meter<T>(
    input: ProviderInput,
    invoke: (input: ProviderInput) => Promise<T>,
    purpose: import("@t-box/shared").ModelCallPurpose,
  ): Promise<T> {
    const execution = input.execution;
    if (!execution)
      throw new ApiError(
        401,
        "BILLING_IDENTITY_REQUIRED",
        "请登录后使用 AI 会话",
      );
    input.signal.throwIfAborted();
    // Conservative admission budget, not billable usage. JSON/UTF-8 includes
    // tool schemas, attachments and prior reasoning; final fee uses usage only.
    const estimate = estimateInputTokens(input);
    const mode = await this.billing.begin({
      id: execution.operationId,
      userId: execution.userId,
      taskId: execution.taskId,
      messageId: execution.messageId,
      agentId: execution.agentId,
      purpose,
      modelId: this.modelId,
      prices: this.prices,
      kind: "conversation",
      reserve: tokenFee(
        this.prices,
        estimate,
        input.outputTokenBudget ?? this.maxOutputTokens ?? 8192,
      ),
    });
    let settled = false;
    try {
      const turn = await invoke({
        ...input,
        onUsage: async (usage) => {
          try {
            await this.billing.settle(
              execution.userId,
              execution.operationId,
              usage,
            );
          } catch (error) {
            if (error instanceof ApiError && error.code === "USAGE_REVIEW")
              await input.onUsage?.(usage);
            throw error;
          }
          settled = true;
          await input.onUsage?.(usage);
        },
      });
      if (!settled) {
        await this.billing.uncertain(execution.userId, execution.operationId);
        // Missing metering must not disable genuine free/waived model output.
        // Keep an unknown-usage audit record, but only paid calls need a fee gate.
        if (
          mode === "record_only" ||
          (money(this.prices.inputPrice) === 0n &&
            money(this.prices.outputPrice) === 0n)
        )
          return turn;
        throw new ApiError(
          502,
          "USAGE_MISSING",
          "服务商未返回有效用量，本次费用待核对；不会自动重试",
        );
      }
      return turn;
    } catch (error) {
      if (!settled)
        await this.billing.uncertain(execution.userId, execution.operationId);
      throw error;
    }
  }
  // Title generation never enters the user's billing pipeline.
  async title(input: { text: string; signal: AbortSignal }) {
    return this.provider.title ? this.provider.title(input) : "";
  }
}
