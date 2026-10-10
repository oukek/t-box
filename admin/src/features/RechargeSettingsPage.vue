<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { AdminRechargeConfiguration, RechargePreset } from "@t-box/shared";
import { request, save, errorMessage } from "../core/api";
import AdminDialog from "../components/AdminDialog.vue";
const config = ref<AdminRechargeConfiguration | null>(null),
  loading = ref(true),
  busy = ref(false),
  open = ref(false),
  error = ref(""),
  formError = ref("");
const form = reactive({
  presets: [] as RechargePreset[],
  bonusRules: [] as { threshold: string; bonus: string }[],
  customEnabled: false,
  revision: 1,
});
async function load() {
  loading.value = true;
  error.value = "";
  try {
    config.value = await request<AdminRechargeConfiguration>(
      "/payments/recharge-options",
    );
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
function edit() {
  if (!config.value) return;
  form.presets = config.value.presets.map((preset) => ({ ...preset }));
  form.bonusRules = config.value.bonusRules.map((rule) => ({ ...rule }));
  form.customEnabled = config.value.customEnabled;
  form.revision = config.value.revision;
  formError.value = "";
  open.value = true;
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  formError.value = "";
  try {
    config.value = await save<AdminRechargeConfiguration>(
      "/payments/recharge-options",
      form,
      "PATCH",
    );
    open.value = false;
  } catch (cause) {
    formError.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">RECHARGE</p>
      <h1>充值配置</h1>
      <p>管理充值套餐、套餐优惠与自定义充值，适用于网页与 Android。</p>
    </div>
    <div class="actions">
      <button class="primary" :disabled="loading || !config" @click="edit">
        编辑配置</button
      ><button :disabled="loading" @click="load">刷新</button>
    </div>
  </header>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section class="panel">
    <div class="panel-heading">
      <h2>充值套餐</h2>
      <span class="badge">最低 1 元</span>
    </div>
    <div v-if="loading" class="empty">正在读取充值配置…</div>
    <div v-else-if="config" class="recharge-settings-content">
      <p v-if="!config.presets.length" class="muted">
        暂无充值套餐，可在编辑配置中添加。
      </p>
      <div class="recharge-settings-presets">
        <span
          v-for="preset in config.presets"
          :key="preset.amount"
          :class="{ 'preset-offline': !preset.enabled }"
          ><strong>¥{{ Number(preset.amount) }}</strong
          ><small>{{
            Number(preset.bonusAmount) > 0
              ? `赠 ¥${Number(preset.bonusAmount)}`
              : "无赠送"
          }}</small
          ><small v-if="!preset.enabled">已下架</small></span
        >
      </div>
      <div class="recharge-custom-status">
        <h3>自定义充值</h3>
        <span class="badge" :class="{ disabled: !config.customEnabled }">{{
          config.customEnabled ? "已开启" : "未开启"
        }}</span>
      </div>
      <p v-if="!config.customEnabled" class="muted">
        用户只能选择已上架的充值套餐，不显示自定义金额输入框。
      </p>
      <template v-else
        ><p v-if="!config.bonusRules.length" class="muted">
          自定义金额按实付到账，不赠送余额。
        </p>
        <div v-else class="recharge-settings-rules">
          <div v-for="rule in config.bonusRules" :key="rule.threshold">
            <span>自定义金额满 ¥{{ Number(rule.threshold) }}</span
            ><strong>赠 ¥{{ Number(rule.bonus) }}</strong>
          </div>
        </div></template
      >
      <p class="muted">
        套餐使用各自的优惠；自定义金额的满赠只取最高达标档，不与套餐优惠叠加。
      </p>
      <p class="muted">
        赠送金额在订单创建时固定，修改优惠或下架套餐不影响已有订单。实付与赠送分别记流水，到账由服务端确认。
      </p>
    </div>
  </section>
  <AdminDialog
    :open="open"
    title="编辑充值配置"
    description="每个套餐可单独设置赠送，充值金额范围 1–10000 元。"
    :busy="busy"
    @close="open = false"
  >
    <form id="recharge-settings-form" @submit.prevent="submit">
      <fieldset :disabled="busy">
        <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
        <div class="recharge-editor-heading">
          <h3>充值套餐</h3>
          <button
            type="button"
            :disabled="form.presets.length >= 12"
            @click="
              form.presets.push({ amount: '', bonusAmount: '0', enabled: true })
            "
          >
            添加套餐
          </button>
        </div>
        <div class="recharge-preset-editor">
          <article
            v-for="(preset, index) in form.presets"
            :key="index"
            class="recharge-preset-card"
          >
            <div class="preset-controls">
              <label
                ><input
                  v-model="preset.enabled"
                  type="checkbox"
                  :aria-label="`套餐 ${index + 1} 上架`"
                />上架</label
              ><button
                type="button"
                :aria-label="`删除套餐 ${index + 1}`"
                @click="form.presets.splice(index, 1)"
              >
                删除
              </button>
            </div>
            <div class="preset-fields">
              <label
                >充值金额 {{ index + 1 }} / 元<input
                  v-model="preset.amount"
                  inputmode="decimal"
                  required /></label
              ><label
                >赠送金额 {{ index + 1 }} / 元<input
                  v-model="preset.bonusAmount"
                  inputmode="decimal"
                  required
              /></label>
            </div>
          </article>
        </div>
        <label class="recharge-custom-switch"
          ><input
            v-model="form.customEnabled"
            type="checkbox"
          />开启自定义充值</label
        >
        <p class="muted">
          默认关闭。开启后允许用户输入 1–10000 元，可另设自定义金额的满赠规则。
        </p>
        <template v-if="form.customEnabled"
          ><div class="recharge-editor-heading">
            <h3>自定义充值满赠</h3>
            <button
              type="button"
              :disabled="form.bonusRules.length >= 20"
              @click="form.bonusRules.push({ threshold: '', bonus: '' })"
            >
              添加规则
            </button>
          </div>
          <p class="muted">只取最高达标档，不设置则不赠送；不影响套餐优惠。</p>
          <div
            v-for="(rule, index) in form.bonusRules"
            :key="index"
            class="recharge-editor-row"
          >
            <label
              >满 / 元<input
                v-model="rule.threshold"
                inputmode="decimal"
                required /></label
            ><label
              >赠 / 元<input
                v-model="rule.bonus"
                inputmode="decimal"
                required /></label
            ><button
              type="button"
              :aria-label="`删除规则 ${index + 1}`"
              @click="form.bonusRules.splice(index, 1)"
            >
              删除
            </button>
          </div></template
        >
      </fieldset>
    </form>
    <template #footer
      ><button :disabled="busy" @click="open = false">取消</button
      ><button
        class="primary"
        type="submit"
        form="recharge-settings-form"
        :disabled="busy"
      >
        {{ busy ? "正在保存…" : "保存配置" }}
      </button></template
    >
  </AdminDialog>
</template>
<style scoped>
.recharge-settings-content {
  padding: 24px 28px;
}
.recharge-settings-content h3 {
  font-size: 14px;
  margin: 0 0 14px;
}
.recharge-settings-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 28px;
}
.recharge-settings-presets > span {
  padding: 12px 20px;
  border: 1px solid #e0e7e3;
  border-radius: 10px;
  background: #f6f9f7;
  color: #416555;
  font-variant-numeric: tabular-nums;
}
.recharge-settings-content p {
  font-size: 12px;
  line-height: 1.8;
  margin-top: 18px;
}
.recharge-settings-rules {
  max-width: 560px;
}
.recharge-settings-rules > div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ee;
  padding: 14px 0;
  font-size: 13px;
}
.recharge-settings-rules strong {
  font-weight: 500;
  color: #416555;
}
.recharge-editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 0 12px;
  gap: 12px;
}
.recharge-editor-heading h3 {
  font-size: 14px;
  margin: 0;
}
.recharge-preset-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}
.recharge-editor-row {
  display: flex;
  align-items: end;
  gap: 12px;
  margin: 12px 0;
}
.recharge-editor-row label {
  flex: 1;
  min-width: 0;
}
.recharge-editor-row button {
  margin-bottom: 1px;
}
.recharge-editor-row input {
  width: 100%;
}
.recharge-editor-heading button,
.recharge-editor-row button {
  font-size: 12px;
  white-space: nowrap;
}
.recharge-editor-row button {
  color: #91695d;
}
@media (max-width: 600px) {
  .recharge-preset-editor {
    grid-template-columns: 1fr;
  }
  .recharge-settings-content {
    padding: 20px;
  }
  .recharge-editor-row {
    gap: 8px;
  }
}
.recharge-settings-presets > span {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.recharge-settings-presets strong {
  font-weight: 500;
}
.recharge-settings-presets small {
  font-size: 11px;
  color: #6c897b;
}
.recharge-settings-presets .preset-offline {
  opacity: 0.55;
}
.recharge-custom-status {
  display: flex;
  align-items: center;
  gap: 12px;
}
.recharge-custom-status h3 {
  margin: 0;
}
.recharge-preset-card {
  border: 1px solid #e3e8e5;
  border-radius: 10px;
  padding: 12px;
  margin: 6px 0;
}
.preset-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.preset-controls label,
.recharge-custom-switch {
  display: flex;
  align-items: center;
  gap: 7px;
}
.preset-controls input,
.recharge-custom-switch input {
  width: auto !important;
}
.preset-controls label {
  font-size: 12px;
}
.preset-controls button {
  font-size: 11px;
  padding: 4px 8px;
}
.preset-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preset-fields label {
  font-size: 12px;
  min-width: 0;
}
.recharge-custom-switch {
  margin-top: 24px;
  font-size: 13px;
}
</style>
