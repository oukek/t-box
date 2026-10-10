/** Deterministic test provider. Never imported by production source. */
import { randomUUID } from "node:crypto";
import type { Bill, BillInput, BillCategory, ToolResult } from "@t-box/shared";
import type {
  ChatProvider,
  ProviderInput,
  ProviderItem,
  ProviderTurn,
} from "../src/chat/provider.js";
function call(name: string, args: unknown): ProviderTurn {
  const id = randomUUID();
  const arguments_ = JSON.stringify(args);
  return {
    calls: [{ id, name, arguments: arguments_ }],
    output: [
      { type: "function_call", call_id: id, name, arguments: arguments_ },
    ],
  };
}

function userText(item: ProviderItem | undefined): string | undefined {
  if (!item || !("role" in item) || item.role !== "user") return undefined;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    const part = item.content.find((p) => p.type === "input_text");
    return part?.type === "input_text" ? part.text : undefined;
  }
  return undefined;
}

function getResult(
  items: ProviderItem[],
  name: string,
): ToolResult | undefined {
  const invocation = items.find(
    (item) => item.type === "function_call" && item.name === name,
  );
  if (!invocation || invocation.type !== "function_call") return undefined;
  const result = items.find(
    (item) =>
      item.type === "function_call_output" &&
      item.call_id === invocation.call_id,
  );
  return result?.type === "function_call_output" &&
    typeof result.output === "string"
    ? (JSON.parse(result.output) as ToolResult)
    : undefined;
}

/** Deterministic grammar for isolated tool-loop tests only. */
export class FixtureChatProvider implements ChatProvider {
  readonly mode = "openai";
  async next(input: ProviderInput): Promise<ProviderTurn> {
    input.signal.throwIfAborted();
    const lastUser = input.history.findLastIndex(
      (item) => userText(item) !== undefined,
    );
    let text = userText(input.history[lastUser]!)?.trim() ?? "";
    const current = input.history.slice(lastUser + 1);
    const say = async (content: string): Promise<ProviderTurn> => {
      for (const delta of content.match(/.{1,12}/gu) ?? []) {
        input.signal.throwIfAborted();
        input.onDelta(delta);
        await Promise.resolve();
      }
      return { output: [{ role: "assistant", content }], calls: [] };
    };
    if (
      "content" in (input.history[lastUser] || {}) &&
      Array.isArray((input.history[lastUser] as any)?.content)
    )
      return say(
        "附件已保存到我的资源。当前为演示模式，无法识别图片或生成、编辑图片；在后台配置支持看图的普通会话模型和图片工具模型后即可使用。",
      );
    if (/^(0|[1-9]\d{0,8})(?:\.\d{1,2})?\s*元?$/.test(text)) {
      const previous = input.history.slice(0, lastUser);
      const previousUser = previous.findLastIndex(
        (item) => userText(item) !== undefined,
      );
      const previousText = userText(previous[previousUser]!)?.trim();
      const asked = previous
        .slice(previousUser + 1)
        .some(
          (item) =>
            "role" in item &&
            item.role === "assistant" &&
            typeof item.content === "string" &&
            item.content.startsWith("请告诉我这笔"),
        );
      if (
        asked &&
        previousText &&
        /^(买菜|早餐|午餐|晚餐|工资|奖金)$/.test(previousText)
      )
        text = `${previousText} ${text}`;
    }
    if (/^(买菜|早餐|午餐|晚餐|工资|奖金)$/.test(text)) {
      return say(
        "请告诉我这笔的金额，例如 35 或 35.50。确认金额前不会写入账单。",
      );
    }
    const match =
      /^(买菜|早餐|午餐|晚餐|工资|奖金)\s*(0|[1-9]\d{0,8})(\.\d{1,2})?\s*元?(?:\s+备注[：:]\s*([^\d]{1,120}))?$/.exec(
        text,
      );
    const opening = /^(打开记账|打开账本)$/.test(text);
    const listing = /^(查看账单|查账单|本月账单)$/.test(text);
    const summarizing = /^(本月汇总|本月收支|本月花了多少)$/.test(text);
    if (!match && !opening && !listing && !summarizing) {
      return say(
        "演示模式只处理明确指令：买菜 35、午餐 28、工资 5000、查看账单、本月汇总、打开记账。备注可写“买菜 35 备注：晚餐食材”。含多个金额、假设或否定的表达不会记账。",
      );
    }
    const created = getResult(current, "bills_create");
    const opened = getResult(current, "app_open");
    const activated = getResult(current, "skill_activate");
    if (activated && !activated.ok)
      return say(`未能启用记账能力：${activated.error.message}`);
    if (created && !created.ok)
      return say(
        created.error.code === "TOOL_FAILED"
          ? "未能确认账单保存结果，请先打开账本核对，不要重复提交。"
          : `未创建账单：${created.error.message}`,
      );
    const bill = created?.ok ? (created.data as Bill) : undefined;
    if (opened) {
      return say(
        `${bill ? `已记录${bill.type === "income" ? "收入" : "支出"} ¥${bill.amount}。` : ""}${opened.ok ? "记账应用已打开。" : `应用未能打开：${opened.error.message}。${bill ? "账单已保存，无需重复记账。" : ""}`}`,
      );
    }
    if (opening)
      return call("app_open", {
        appId: "ledger",
        params: { month: null, billId: null, ledgerId: null },
      });
    if (!input.tools.some((tool) => tool.name === "bills_create"))
      return call("skill_activate", { skillId: "bookkeeping" });
    if (match && !created) {
      const title = match[1]!;
      const type = ["工资", "奖金"].includes(title) ? "income" : "expense";
      const loaded = getResult(current, "categories_list");
      if (!loaded) return call("categories_list", {});
      if (!loaded.ok) return say(`未读取分类：${loaded.error.message}`);
      const categories = loaded.data as BillCategory[];
      const label =
        title === "工资" ? "工资" : title === "奖金" ? "奖金" : "餐饮";
      const category =
        categories.find((item) => item.type === type && item.label === label) ??
        categories.find((item) => item.type === type && item.isDefault);
      if (!category)
        return say("没有可用分类，请先在记账页面创建该收支类型的分类。");
      const billInput: BillInput = {
        type,
        amount: `${match[2]}${match[3] ?? ""}`,
        date: input.localDate,
        category: category.id,
        note: match[4]?.trim() ?? title,
      };
      return call("bills_create", billInput);
    }
    if (bill)
      return call("app_open", {
        appId: "ledger",
        params: {
          month: bill.date.slice(0, 7),
          billId: bill.id,
          ledgerId: null,
        },
      });
    const toolName = summarizing ? "bills_summary" : "bills_list";
    const result = getResult(current, toolName);
    if (!result)
      return call(
        toolName,
        summarizing
          ? { month: input.localDate.slice(0, 7) }
          : {
              month: input.localDate.slice(0, 7),
              type: null,
              q: null,
              page: 1,
              pageSize: 20,
            },
      );
    if (!result.ok) return say(`查询失败：${result.error.message}`);
    const data = result.data as {
      income?: string;
      expense?: string;
      balance?: string;
      meta?: { total: number };
    };
    return say(
      summarizing
        ? `本月收入 ¥${data.income}，支出 ¥${data.expense}，结余 ¥${data.balance}。`
        : `本月共有 ${data.meta?.total ?? 0} 笔账单。可发送“打开记账”查看明细。`,
    );
  }
}
