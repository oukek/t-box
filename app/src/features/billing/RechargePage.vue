<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { WechatPay } from "@t-box/capacitor-wechat-pay";
import {
  rechargeCents,
  rechargeOfferBonusCents,
  type RechargeConfiguration,
  type PaymentOrder,
  type PaymentCapabilities,
} from "@t-box/shared";
import ApplicationHeader from "@t-box/ui-kit/ApplicationHeader.vue";
import { AppIcon } from "@t-box/ui-kit";
import { openWallet } from "../../core/navigation";
import { request, RequestError } from "../../core/network";
import {
  paymentMode,
  purchaseBlockReason,
  useWechatCheckout,
} from "./wechatCheckout";
import CheckoutDialog from "./CheckoutDialog.vue";
import { displayMoney as fee, centsYuan } from "./format";
import "./recharge.css";
const unavailable = purchaseBlockReason();
const config = ref<RechargeConfiguration | null>(null),
  amount = ref(""),
  loading = ref(true),
  busy = ref(false),
  error = ref(""),
  enabled = ref(false),
  reason = ref(unavailable || "在线充值尚未开放。");
const pendingOrder = ref<PaymentOrder | null>(null),
  attemptedAmount = ref<string | null>(null);
const checkout = useWechatCheckout(async () => {
  pendingOrder.value = checkout.order.value;
});
const cents = computed(() => rechargeCents(amount.value));
const bonus = computed(() =>
  pendingOrder.value
    ? fee(pendingOrder.value.bonusAmount)
    : centsYuan(
        cents.value === null
          ? 0
          : config.value
            ? (rechargeOfferBonusCents(cents.value, config.value) ?? 0)
            : 0,
      ),
);
const total = computed(() =>
  pendingOrder.value
    ? fee(pendingOrder.value.creditedAmount)
    : centsYuan(
        (cents.value ?? 0) +
          (cents.value === null
            ? 0
            : config.value
              ? (rechargeOfferBonusCents(cents.value, config.value) ?? 0)
              : 0),
      ),
);
const locked = computed(
  () => busy.value || attemptedAmount.value !== null || !!pendingOrder.value,
);
const payable = computed(
  () =>
    !pendingOrder.value ||
    (pendingOrder.value.status === "pending" &&
      Date.parse(pendingOrder.value.expiresAt) > Date.now()),
);
let key = crypto.randomUUID();
let controller: AbortController | undefined;
async function load() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  enabled.value = false;
  error.value = "";
  try {
    const [options, capabilities] = await Promise.all([
      request<{ data: RechargeConfiguration }>("/payments/recharge-options", {
        signal,
      }),
      request<{ data: PaymentCapabilities }>("/payments/capabilities", {
        signal,
      }),
    ]);
    if (signal.aborted) return;
    config.value = options.data;
    if (
      !pendingOrder.value &&
      attemptedAmount.value === null &&
      (!amount.value ||
        (!options.data.customEnabled &&
          !options.data.presets.some(
            (preset) =>
              rechargeCents(preset.amount) === rechargeCents(amount.value),
          )))
    )
      amount.value = options.data.presets[0]?.amount ?? "";
    enabled.value =
      !unavailable &&
      capabilities.data.enabled &&
      (!capabilities.data.modes ||
        capabilities.data.modes.includes(paymentMode()));
    reason.value = unavailable || "当前支付方式暂未开放。";
    if (paymentMode() === "app" && !unavailable) {
      enabled.value = false;
      const status = await WechatPay.getStatus();
      if (signal.aborted) return;
      if (!status.configured || status.appId !== capabilities.data.mobileAppId)
        reason.value = "当前 App 的微信支付尚未开放。";
      else if (!status.installed)
        reason.value = "请安装微信后刷新此页面再充值。";
      else
        enabled.value =
          capabilities.data.enabled &&
          (!capabilities.data.modes || capabilities.data.modes.includes("app"));
    }
  } catch (cause) {
    if (!signal.aborted)
      error.value = cause instanceof Error ? cause.message : "读取充值配置失败";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
async function submit() {
  if (
    purchaseBlockReason() ||
    !enabled.value ||
    loading.value ||
    busy.value ||
    !payable.value
  )
    return;
  if (
    cents.value === null ||
    (config.value &&
      rechargeOfferBonusCents(cents.value, config.value) === null &&
      !pendingOrder.value &&
      attemptedAmount.value === null)
  ) {
    error.value = "充值金额至少 1 元，最多 10000 元，支持 2 位小数。";
    return;
  }
  busy.value = true;
  error.value = "";
  attemptedAmount.value ??= amount.value;
  try {
    if (!pendingOrder.value) {
      const previewBonus = bonus.value;
      pendingOrder.value = (
        await request<{ data: PaymentOrder }>("/payments/orders", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ amount: attemptedAmount.value }),
        })
      ).data;
      if (fee(pendingOrder.value.bonusAmount) !== previewBonus)
        throw new Error("充值优惠已更新，请确认当前到账金额后继续支付。");
    }
    amount.value = fee(pendingOrder.value.amount);
    await checkout.pay(pendingOrder.value);
  } catch (cause) {
    if (
      !pendingOrder.value &&
      cause instanceof RequestError &&
      cause.code === "CUSTOM_RECHARGE_DISABLED"
    ) {
      attemptedAmount.value = null;
      key = crypto.randomUUID();
      await load();
    }
    error.value = cause instanceof Error ? cause.message : "发起支付失败";
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  await load();
  if (controller?.signal.aborted) return;
  await checkout.resume();
  if (controller?.signal.aborted) return;
  if (checkout.order.value) {
    pendingOrder.value = checkout.order.value;
    amount.value = fee(checkout.order.value.amount);
  }
});
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <section class="billing-detail-page">
    <ApplicationHeader title="余额充值" back-label="余额" @back="openWallet">
      <template #actions
        ><button
          class="wallet-refresh"
          aria-label="刷新充值配置"
          :disabled="loading"
          @click="load"
        >
          <AppIcon name="refresh" :size="19" /></button
      ></template>
    </ApplicationHeader>
    <p class="billing-page-intro">选择充值金额，用于 AI 会话与图片处理。</p>
    <p v-if="error" class="wallet-error" role="alert">
      {{ error }}
      <button v-if="!config" class="billing-text-button" @click="load">
        重新加载
      </button>
    </p>
    <div v-if="loading" class="wallet-empty">正在读取充值配置…</div>
    <form v-else-if="config" class="recharge-form" @submit.prevent="submit">
      <fieldset :disabled="locked">
        <legend>选择金额</legend>
        <div class="recharge-presets">
          <button
            v-for="preset in config.presets"
            :key="preset.amount"
            type="button"
            :class="{
              selected: rechargeCents(amount) === rechargeCents(preset.amount),
            }"
            :aria-pressed="
              rechargeCents(amount) === rechargeCents(preset.amount)
            "
            @click="amount = fee(preset.amount)"
          >
            <strong><small>¥</small>{{ fee(preset.amount) }}</strong>
            <span v-if="Number(preset.bonusAmount) > 0"
              >赠 ¥{{ fee(preset.bonusAmount) }}</span
            >
            <span v-else>到账 ¥{{ fee(preset.amount) }}</span>
            <AppIcon
              v-if="rechargeCents(amount) === rechargeCents(preset.amount)"
              name="check"
              :size="13"
            />
          </button>
        </div>
        <label
          v-if="config.customEnabled"
          class="recharge-custom"
          for="recharge-amount"
          ><span
            >自定义金额<small>最低 ¥{{ config.minAmount }}</small></span
          >
          <div>
            <span>¥</span
            ><input
              id="recharge-amount"
              v-model="amount"
              aria-describedby="recharge-amount-help"
              inputmode="decimal"
              autocomplete="off"
              maxlength="8"
              placeholder="输入金额"
              required
              pattern="[0-9]+([.][0-9]{1,2})?"
            /></div
        ></label>
        <p
          v-if="config.customEnabled"
          id="recharge-amount-help"
          class="recharge-hint"
        >
          1–10000 元，最多 2 位小数
        </p>
      </fieldset>
      <p
        v-if="!config.presets.length && !config.customEnabled && !pendingOrder"
        class="recharge-hint"
      >
        暂无可用充值套餐，请稍后再试。
      </p>
      <div class="recharge-summary">
        <div>
          <span>实付金额</span
          ><strong>¥{{ cents === null ? "—" : centsYuan(cents) }}</strong>
        </div>
        <div v-if="Number(bonus) > 0" class="recharge-bonus">
          <span>赠送余额</span><strong>+ ¥{{ bonus }}</strong>
        </div>
        <div class="recharge-total">
          <span>到账余额</span
          ><strong>¥{{ cents === null ? "—" : total }}</strong>
        </div>
      </div>
      <p v-if="pendingOrder" class="recharge-hint">
        此订单金额与赠送已固定。{{
          pendingOrder.status === "paid"
            ? "已支付到账。"
            : pendingOrder.status === "closed" || !payable
              ? "订单已关闭或过期。"
              : "可继续支付原订单。"
        }}
      </p>
      <p
        v-if="unavailable || !enabled"
        id="recharge-unavailable"
        class="recharge-unavailable"
        role="status"
      >
        <AppIcon name="info" :size="16" />{{ reason }}
      </p>
      <button
        class="button button-primary recharge-submit"
        :disabled="
          busy ||
          !enabled ||
          cents === null ||
          !payable ||
          (!pendingOrder &&
            !attemptedAmount &&
            config &&
            rechargeOfferBonusCents(cents, config) === null)
        "
        :aria-describedby="!enabled ? 'recharge-unavailable' : undefined"
      >
        {{
          busy
            ? "正在发起…"
            : pendingOrder?.status === "paid"
              ? "已到账"
              : !payable
                ? "订单不可支付"
                : pendingOrder || attemptedAmount
                  ? "继续支付原订单"
                  : "微信支付"
        }}
      </button>
      <p class="recharge-hint">支付确认后自动到账，可在余额页查看充值订单。</p>
      <details
        v-if="config.customEnabled && config.bonusRules.length"
        class="recharge-rules"
      >
        <summary>自定义充值满赠规则</summary>
        <p v-for="rule in config.bonusRules" :key="rule.threshold">
          单笔满 ¥{{ fee(rule.threshold) }}，赠 ¥{{ fee(rule.bonus) }}
        </p>
        <p>
          套餐使用各自的赠送优惠；自定义金额只取最高达标档，不叠加。实际赠送以订单为准。
        </p>
      </details>
    </form>
    <CheckoutDialog
      :open="checkout.open.value"
      :order="checkout.order.value"
      :qr="checkout.qr.value"
      :notice="checkout.notice.value"
      :error="checkout.error.value"
      :unavailable="!!unavailable"
      @close="checkout.close"
    />
  </section>
</template>
