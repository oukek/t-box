import { RechargeSettingsService } from "./recharge.js";
import { randomUUID } from "node:crypto";
import type {
  PaymentOrder,
  PaymentCapabilities,
  WechatPaymentMode,
} from "@t-box/shared";
import type { DataSource } from "typeorm";
import { BillingService } from "../billing/service.js";
import { money, decimal } from "../billing/money.js";
import { ApiError } from "@t-box/server-foundation/errors";
import { isoTime } from "@t-box/ledger-server/ledgers/time";
import type { PaymentGateway, VerifiedPayment } from "./gateway.js";
type OrderRow = {
  id: string;
  configuration_id?: string | null;
  user_id: string;
  amount_cents: number;
  bonus_cents: number;
  currency: "CNY";
  status: PaymentOrder["status"];
  created_at: Date | string;
  expires_at: Date | string;
  paid_at: Date | string | null;
  transaction_id: string | null;
};
const view = (r: OrderRow): PaymentOrder => ({
  id: r.id,
  amount: decimal(BigInt(r.amount_cents) * 10_000n),
  bonusAmount: decimal(BigInt(r.bonus_cents ?? 0) * 10_000n),
  creditedAmount: decimal(
    BigInt(r.amount_cents + (r.bonus_cents ?? 0)) * 10_000n,
  ),
  currency: r.currency,
  status: r.status,
  createdAt: isoTime(r.created_at),
  expiresAt: isoTime(r.expires_at),
  paidAt: r.paid_at ? isoTime(r.paid_at) : null,
});
export function requestKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,64}$/.test(value))
    throw new ApiError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "请提供有效的 Idempotency-Key",
    );
  return value;
}
export class PaymentService {
  constructor(
    readonly source: DataSource,
    readonly billing: BillingService,
    private readonly gateway?: PaymentGateway,
    private readonly bonusPolicy?: Pick<RechargeSettingsService, "bonusCents">,
  ) {}
  async capabilities(): Promise<PaymentCapabilities> {
    return this.gateway?.capabilities
      ? this.gateway.capabilities()
      : { enabled: !!this.gateway, channel: "wechat" };
  }
  private adapter() {
    if (!this.gateway)
      throw new ApiError(
        503,
        "PAYMENT_NOT_CONFIGURED",
        "在线充值尚未开放，请稍后再试",
      );
    return this.gateway;
  }
  async create(
    userId: string,
    amount: unknown,
    key: string,
  ): Promise<PaymentOrder> {
    const gateway = this.adapter();
    const configurationId = await gateway.configurationId?.();
    const micros = money(amount);
    if (
      micros < 1_000_000n ||
      micros > 10_000n * 1_000_000n ||
      micros % 10_000n
    )
      throw new ApiError(
        400,
        "INVALID_RECHARGE",
        "充值金额须为 1–10000 元，最多 2 位小数",
      );
    requestKey(key);
    return this.source.transaction(async (db) => {
      // Serialize order creation per wallet and bound pending orders per user.
      await this.billing.lock(db, userId);
      const [old]: OrderRow[] = await db.query(
        "SELECT * FROM payment_orders WHERE user_id=? AND request_key=?",
        [userId, key],
      );
      if (old) {
        if (old.amount_cents !== Number(micros / 10_000n))
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "重复请求金额不一致");
        return view(old);
      }
      const [pending] = await db.query(
        "SELECT COUNT(*) n FROM payment_orders WHERE user_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3)",
        [userId],
      );
      if (Number(pending.n) >= 10)
        throw new ApiError(
          429,
          "ORDER_LIMIT",
          "待支付订单过多，请先处理已有订单",
        );
      const bonusCents = await (
        this.bonusPolicy ?? new RechargeSettingsService(db)
      ).bonusCents(Number(micros / 10_000n));
      const id = randomUUID();
      await db.query(
        "INSERT INTO payment_orders(id,user_id,request_key,amount_cents,configuration_id,bonus_cents,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))",
        [
          id,
          userId,
          key,
          Number(micros / 10_000n),
          configurationId ?? null,
          bonusCents,
        ],
      );
      const [row] = await db.query("SELECT * FROM payment_orders WHERE id=?", [
        id,
      ]);
      return view(row);
    });
  }
  async get(userId: string, id: string) {
    const [row]: OrderRow[] = await this.source.query(
      "SELECT * FROM payment_orders WHERE id=? AND user_id=?",
      [id, userId],
    );
    if (!row) throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在");
    return view(row);
  }
  async list(userId?: string): Promise<PaymentOrder[]> {
    const rows: OrderRow[] = await this.source.query(
      `SELECT * FROM payment_orders ${userId ? "WHERE user_id=?" : ""} ORDER BY created_at DESC,id DESC LIMIT 100`,
      userId ? [userId] : [],
    );
    return rows.map(view);
  }
  async adminList() {
    const rows = await this.source.query(
      "SELECT o.*,u.username,u.nickname FROM payment_orders o JOIN app_users u ON u.id=o.user_id ORDER BY o.created_at DESC,o.id DESC LIMIT 100",
    );
    return rows.map((r: OrderRow & { username: string; nickname: string }) => ({
      ...view(r),
      userId: r.user_id,
      username: r.username,
      nickname: r.nickname,
    }));
  }
  async intent(
    userId: string,
    id: string,
    mode: WechatPaymentMode = "native",
    clientIp?: string,
  ) {
    const gateway = this.adapter();
    const order = await this.get(userId, id);
    if (order.status !== "pending" || Date.parse(order.expiresAt) <= Date.now())
      throw new ApiError(409, "ORDER_NOT_PAYABLE", "订单已支付、关闭或过期");
    // Adapter must use this local id as merchant order number; repeat creation
    // must recover the same upstream order after an unknown network outcome.
    if (!["native", "h5", "jsapi", "app"].includes(mode))
      throw new ApiError(400, "INVALID_PAYMENT_MODE", "支付方式无效");
    const context = await this.source.transaction(async (db) => {
      const [row] = await db.query(
        "SELECT configuration_id,payment_mode FROM payment_orders WHERE id=? AND user_id=? FOR UPDATE",
        [id, userId],
      );
      if (row.payment_mode && row.payment_mode !== mode)
        throw new ApiError(
          409,
          "PAYMENT_MODE_LOCKED",
          "此订单已使用另一种支付方式，请在原客户端继续，或关闭后重新充值",
        );
      await db.query("UPDATE payment_orders SET payment_mode=? WHERE id=?", [
        mode,
        id,
      ]);
      return {
        configurationId: row.configuration_id ?? undefined,
        mode,
        clientIp,
        userId,
      };
    });
    return gateway.create(
      order,
      Number(money(order.amount) / 10_000n),
      context,
    );
  }
  async close(userId: string, id: string) {
    const order = await this.get(userId, id);
    if (order.status === "paid")
      throw new ApiError(409, "ORDER_PAID", "已支付订单不能关闭");
    if (order.status === "closed") return;
    await this.adapter().close(id, await this.context(id));
    await this.source.query(
      "UPDATE payment_orders SET status='closed' WHERE id=? AND user_id=? AND status='pending'",
      [id, userId],
    );
    return this.get(userId, id);
  }
  async notify(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const adapter = this.adapter();
    if (!Buffer.isBuffer(raw))
      throw new ApiError(
        415,
        "PAYMENT_BODY_INVALID",
        "支付通知须使用 application/json 原始请求体",
      );
    const event = await adapter.verify(raw, headers);
    await this.accept(event);
  }
  private async context(id: string) {
    const [row] = await this.source.query(
      "SELECT configuration_id,payment_mode FROM payment_orders WHERE id=?",
      [id],
    );
    if (!row) throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在");
    return {
      configurationId: row.configuration_id ?? undefined,
      mode: (row.payment_mode ?? "native") as WechatPaymentMode,
    };
  }
  async refresh(userId: string, id: string) {
    const order = await this.get(userId, id);
    if (order.status !== "paid") {
      const query = await this.source.transaction(async (db) => {
        const [row] = await db.query(
          "SELECT next_query_at>UTC_TIMESTAMP(3) AS limited FROM payment_orders WHERE id=? AND user_id=? FOR UPDATE",
          [id, userId],
        );
        if (row.limited) return false;
        await db.query(
          "UPDATE payment_orders SET next_query_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 SECOND) WHERE id=?",
          [id],
        );
        return true;
      });
      if (query) await this.reconcile(id);
    }
    return this.get(userId, id);
  }
  async reconcile(id: string) {
    const event = await this.adapter().query(id, await this.context(id));
    if (event) {
      if (event.orderId !== id)
        throw new ApiError(409, "PAYMENT_MISMATCH", "渠道返回的订单不一致");
      await this.accept(event);
    }
    return { paid: !!event };
  }
  /** Only gateway-verified events enter this boundary; there is no HTTP mark-paid API. */
  private async accept(event: VerifiedPayment) {
    if (
      !event ||
      typeof event.orderId !== "string" ||
      typeof event.transactionId !== "string" ||
      !(event.paidAt instanceof Date) ||
      !Number.isSafeInteger(event.amountCents) ||
      event.amountCents <= 0 ||
      event.currency !== "CNY" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(event.transactionId) ||
      !Number.isFinite(event.paidAt.getTime()) ||
      event.paidAt.getTime() > Date.now() + 60_000
    )
      throw new ApiError(400, "PAYMENT_INVALID", "渠道通知无效");
    await this.source
      .transaction(async (db) => {
        const [row]: OrderRow[] = await db.query(
          "SELECT * FROM payment_orders WHERE id=? FOR UPDATE",
          [event.orderId],
        );
        if (
          !row ||
          (event.configurationId !== undefined &&
            row.configuration_id !== event.configurationId) ||
          row.amount_cents !== event.amountCents ||
          row.currency !== event.currency ||
          // Channels commonly report whole seconds; local rows have milliseconds.
          event.paidAt.getTime() + 1000 < Date.parse(isoTime(row.created_at)) ||
          event.paidAt.getTime() > Date.parse(isoTime(row.expires_at))
        )
          throw new ApiError(
            409,
            "PAYMENT_MISMATCH",
            "订单金额、币种或支付时间不一致",
          );
        if (row.status === "paid") {
          if (row.transaction_id !== event.transactionId)
            throw new ApiError(409, "PAYMENT_CONFLICT", "订单支付流水不一致");
          return;
        }
        // A delayed, verified successful payment can arrive after local close.
        // Honor real funds; cancel/expiry cannot erase a valid payment.
        await db.query(
          "UPDATE payment_orders SET status='paid',transaction_id=?,paid_at=? WHERE id=?",
          [event.transactionId, event.paidAt, row.id],
        );
        await this.billing.credit(
          db,
          row.user_id,
          BigInt(event.amountCents) * 10_000n,
          `payment:${row.id}`,
          "recharge",
        );
        if (row.bonus_cents > 0)
          await this.billing.credit(
            db,
            row.user_id,
            BigInt(row.bonus_cents) * 10_000n,
            `payment-bonus:${row.id}`,
            "grant",
            "充值满赠",
          );
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY")
          throw new ApiError(
            409,
            "PAYMENT_CONFLICT",
            "该支付流水已关联订单，请核对支付记录",
          );
        throw error;
      });
  }
}
