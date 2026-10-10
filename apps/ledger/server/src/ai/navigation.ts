import { object, nullable } from "@t-box/app-server-sdk";
import type { NavigationAdapter } from "@t-box/app-server-sdk";
import { parseId, validateMonth } from "../validation.js";
export const ledgerNavigation: NavigationAdapter = {
  properties: {
    ledgerId: nullable({ type: "string" }),
    month: nullable({
      type: "string",
      pattern: "^[1-9][0-9]{3}-(0[1-9]|1[0-2])$",
    }),
    billId: nullable({ type: "string" }),
  },
  parse(value) {
    const args = object(value, ["ledgerId", "month", "billId"]);
    const result: Record<string, string> = {};
    if (args.ledgerId != null) result.ledgerId = parseId(args.ledgerId);
    if (args.billId != null) result.billId = parseId(args.billId);
    if (args.month != null) result.month = validateMonth(args.month)!;
    return result;
  },
  contextualize(params, ctx) {
    const target = ctx.bindings.find(
      (ref) => ref.appId === "ledger" && ref.resourceType === "book",
    );
    // Model-supplied navigation never changes the selected execution target.
    return target ? { ...params, ledgerId: target.resourceId } : params;
  },
};
