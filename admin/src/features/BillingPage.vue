<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch, ref } from "vue";
import type { BillingUser, UsageRecord, BillingMode } from "@t-box/shared";
import { request, save, errorMessage } from "../core/api";
import AdminDialog from "../components/AdminDialog.vue";
import AdminSelect from "../components/AdminSelect.vue";
const users = ref<BillingUser[]>([]),
  query = ref(""),
  loading = ref(true),
  busy = ref(false),
  error = ref("");
const selected = ref<BillingUser | null>(null),
  operation = ref<"mode" | "grant" | "usage" | null>(null);
const mode = ref<BillingMode>("charge"),
  amount = ref("10"),
  reason = ref(""),
  dialogError = ref("");
const records = ref<UsageRecord[]>([]),
  recordsLoading = ref(false),
  release = ref<UsageRecord | null>(null);
const reviewAction = ref<"release" | "settle">("release");
let grantKey = crypto.randomUUID();
const filtered = computed(() =>
  users.value.filter((u) =>
    `${u.nickname} ${u.username}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
const states = {
  reserved: "处理中",
  settled: "已结算",
  review: "待核对",
  released: "已解除预留",
};
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let loadRevision = 0;
async function load() {
  const revision = ++loadRevision;
  loading.value = true;
  error.value = "";
  try {
    const items = await request<BillingUser[]>(
      `/billing/users?search=${encodeURIComponent(query.value.trim())}`,
    );
    if (revision === loadRevision) users.value = items;
  } catch (e) {
    if (revision === loadRevision) error.value = errorMessage(e);
  } finally {
    if (revision === loadRevision) loading.value = false;
  }
}
async function edit(user: BillingUser, action: typeof operation.value) {
  selected.value = user;
  operation.value = action;
  mode.value = user.mode;
  reason.value = "";
  amount.value = "10";
  dialogError.value = "";
  release.value = null;
  grantKey = crypto.randomUUID();
  records.value = [];
  if (action === "usage") {
    recordsLoading.value = true;
    try {
      records.value = await request<UsageRecord[]>(
        `/billing/users/${user.id}/usage`,
      );
    } catch (e) {
      dialogError.value = errorMessage(e);
    } finally {
      recordsLoading.value = false;
    }
  }
}
async function submit() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  dialogError.value = "";
  try {
    const path = `/billing/users/${selected.value.id}`;
    if (operation.value === "mode")
      await save(path, { mode: mode.value, reason: reason.value }, "PATCH");
    if (operation.value === "grant")
      await request(`${path}/grants`, {
        method: "POST",
        headers: { "Idempotency-Key": grantKey },
        body: JSON.stringify({ amount: amount.value, reason: reason.value }),
      });
    if (operation.value === "usage" && release.value) {
      await save(`${path}/usage/${release.value.id}/${reviewAction.value}`, {
        reason: reason.value,
      });
      release.value = null;
      reason.value = "";
      records.value = await request<UsageRecord[]>(`${path}/usage`);
    } else operation.value = null;
    await load();
  } catch (e) {
    dialogError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  loadRevision++;
});
onMounted(load);
</script>
<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">BILLING</p>
      <h1>用户与余额</h1>
      <p>配置用户扣费方式，查看实际用量与费用。</p>
    </div>
    <button :disabled="loading" @click="load">刷新</button>
  </header>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section class="panel">
    <div class="panel-heading">
      <h2>
        用户账户 <span class="count">{{ users.length }}</span>
      </h2>
      <div class="search-field">
        <input
          v-model="query"
          aria-label="搜索用户"
          maxlength="64"
          placeholder="搜索昵称或账号"
        />
      </div>
    </div>
    <div v-if="loading" class="empty">正在读取账户…</div>
    <div v-else-if="!filtered.length" class="empty">暂无匹配用户</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>余额 / 元</th>
            <th>可用 / 元</th>
            <th>扣费方式</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <strong>{{ u.nickname }}</strong
              ><span class="cell-secondary">@{{ u.username }}</span>
            </td>
            <td>
              {{ u.balance
              }}<span v-if="u.reserved !== '0.000000'" class="cell-secondary"
                >预留 {{ u.reserved }}</span
              >
            </td>
            <td>{{ u.available }}</td>
            <td>
              <span
                class="badge"
                :class="{ disabled: u.mode === 'record_only' }"
                >{{ u.mode === "charge" ? "实际扣费" : "仅记录费用" }}</span
              >
            </td>
            <td class="actions">
              <button @click="edit(u, 'usage')">使用记录</button
              ><button @click="edit(u, 'mode')">扣费设置</button
              ><button @click="edit(u, 'grant')">赠送余额</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p class="footnote">
    列表最多显示 200
    位匹配用户，可搜索任意已注册账号。仅记录模式不扣余额。设置从下一次调用生效，进行中的调用保留原模式。余额赠送会记录管理员、原因和流水，独立于支付充值。
  </p>
  <AdminDialog
    :open="!!operation"
    :title="
      operation === 'mode'
        ? '扣费设置'
        : operation === 'grant'
          ? '赠送余额'
          : '使用记录'
    "
    :description="
      selected ? `${selected.nickname} · @${selected.username}` : ''
    "
    :busy="busy"
    @close="operation = null"
  >
    <p v-if="dialogError" class="alert" role="alert">{{ dialogError }}</p>
    <form
      v-if="operation !== 'usage'"
      id="billing-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <label v-if="operation === 'mode'"
          >扣费方式<AdminSelect
            v-model="mode"
            label="扣费方式"
            :options="[
              { value: 'charge', label: '实际扣费' },
              { value: 'record_only', label: '仅记录费用，不扣余额' },
            ]"
        /></label>
        <label v-else
          >赠送金额（元）<input
            v-model="amount"
            inputmode="decimal"
            pattern="[0-9]+([.][0-9]{1,6})?"
            required
        /></label>
        <label
          >调整原因<input
            v-model="reason"
            maxlength="200"
            placeholder="必填，保留操作审计"
            required
        /></label>
      </fieldset>
    </form>
    <template v-else
      ><p class="footnote">最近 100 次调用。标题生成不进入用户扣费记录。</p>
      <p v-if="recordsLoading" class="empty">正在读取…</p>
      <p v-else-if="!records.length" class="empty">暂无使用记录</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>服务 / 状态</th>
              <th>用量</th>
              <th>费用 / 实扣</th>
              <th>核对</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>
                {{ r.kind === "image" ? "图片处理" : "AI 会话"
                }}<span class="cell-secondary"
                  >{{ states[r.status] }} ·
                  {{ new Date(r.createdAt).toLocaleString() }}</span
                >
              </td>
              <td>
                {{
                  r.kind === "image"
                    ? `${r.images ?? "—"} 张`
                    : `输入 ${r.inputTokens ?? "—"} / 输出 ${r.outputTokens ?? "—"}`
                }}
              </td>
              <td>
                {{ r.fee }} / {{ r.charged
                }}<span v-if="r.mode === 'record_only'" class="cell-secondary"
                  >仅记录费用</span
                >
              </td>
              <td>
                <button
                  v-if="r.status === 'review'"
                  :disabled="busy"
                  @click="
                    reviewAction = 'release';
                    release = r;
                    reason = '';
                  "
                >
                  解除预留</button
                ><button
                  v-if="
                    r.status === 'review' &&
                    (r.kind === 'image'
                      ? r.images !== null
                      : r.inputTokens !== null && r.outputTokens !== null)
                  "
                  :disabled="busy"
                  @click="
                    reviewAction = 'settle';
                    release = r;
                    reason = '';
                  "
                >
                  结算已知用量
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form
        v-if="release"
        id="billing-form"
        class="dialog-form"
        @submit.prevent="submit"
      >
        <p class="alert">
          核对记录 {{ release.id }}：{{
            reviewAction === "release"
              ? "解除预留会放弃本条用户扣费，请确认服务商结果并填写原因。"
              : "按服务商已返回的实际用量和调用时价格结算，余额不足时请先补充余额。"
          }}不会重新调用模型。
        </p>
        <label
          >核对原因<input v-model="reason" maxlength="200" required
        /></label>
      </form>
    </template>
    <template #footer
      ><button :disabled="busy" @click="operation = null">关闭</button
      ><button
        v-if="operation !== 'usage' || release"
        form="billing-form"
        class="primary"
        type="submit"
        :disabled="busy"
      >
        {{ busy ? "正在保存…" : "确认保存" }}
      </button></template
    >
  </AdminDialog>
</template>
