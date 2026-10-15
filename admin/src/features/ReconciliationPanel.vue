<script setup lang="ts">
import type { DailyReconciliation } from '@t-box/shared'
import { onMounted, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import { errorMessage, request, save } from '../core/api'

const items = ref<DailyReconciliation[]>([])
const open = ref(false)
const selected = ref<DailyReconciliation | null>(null)
const day = ref(
  new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10),
)
const busy = ref(false)
const error = ref('')
const labels: Record<string, string> = {
  pending: '待核对',
  running: '核对中',
  completed: '一致',
  differences: '存在差异',
  failed: '核对失败',
}
const kinds: Record<string, string> = {
  remote_only: '渠道有记录，本地缺失',
  local_only: '本地有记录，渠道未查到',
  amount_mismatch: '金额或流水号不一致',
  state_mismatch: '状态不一致',
}
async function load() {
  try {
    items.value = await request<DailyReconciliation[]>(
      '/payments/reconciliations',
    )
  } catch (e) {
    error.value = errorMessage(e)
  }
}
async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await save('/payments/reconciliations', { day: day.value })
    open.value = false
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="reconciliation-panel">
    <div class="panel-heading">
      <div>
        <h2>每日渠道对账</h2>
        <p class="muted">
          每日 11 点后核对前一日账单，自动补查近 7 天。差异不会直接修改余额。
        </p>
      </div>
      <div class="actions">
        <button :disabled="busy" @click="load">刷新</button><button @click="open = true">选择日期核对</button>
      </div>
    </div>
    <p
      v-if="error && !open"
      class="alert"
      role="alert"
    >{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账单日期</th>
            <th>状态</th>
            <th>交易 / 差异</th>
            <th>最近更新</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.day }}</td>
            <td>
              {{ labels[item.status]
              }}<small v-if="item.error">{{ item.error }}</small>
            </td>
            <td>{{ item.rows }} / {{ item.differences }}</td>
            <td>{{ new Date(item.updatedAt).toLocaleString() }}</td>
            <td>
              <button v-if="item.differences" @click="selected = item">
                查看差异
              </button>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="5" class="muted">暂无对账记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AdminDialog
    :open="open"
    title="按日期核对微信账单"
    :busy="busy"
    compact
    @close="open = false"
  >
    <form id="reconciliation-form" @submit.prevent="submit">
      <label>账单日期<input
        v-model="day"
        type="date"
        required
      ></label>
      <p class="muted">
        使用当前商户配置申请并校验账单，再核对订单和退款流水。支持近 90
        天内、今天之前的日期。
      </p>
      <p
        v-if="error"
        class="alert"
        role="alert"
      >{{ error }}</p>
    </form>
    <template #footer><button :disabled="busy" @click="open = false">取消</button><button
      form="reconciliation-form"
      type="submit"
      class="primary"
      :disabled="busy"
    >
      {{ busy ? '正在核对…' : '开始核对' }}
    </button></template>
  </AdminDialog>
  <AdminDialog
    :open="!!selected"
    title="渠道对账差异"
    :description="selected?.day"
    @close="selected = null"
  ><p class="muted">
     最多显示 500
     条。请在支付订单或退款记录中查询渠道真实结果，核对后重新运行此日对账。
   </p>
    <ol>
      <li v-for="(item, index) in selected?.details" :key="index">
        <strong>{{ kinds[item.kind] }}</strong><code>{{ item.orderId }}</code><code v-if="item.refundId">退款 {{ item.refundId }}</code>
      </li>
    </ol></AdminDialog>
</template>

<style scoped>
.reconciliation-panel {
  margin-top: 28px;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
h2 {
  font-size: 16px;
  margin: 0;
}
small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
label {
  display: grid;
  gap: 10px;
  font-size: 13px;
}
p {
  line-height: 1.7;
}
li {
  margin-bottom: 18px;
  font-size: 13px;
}
code {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
</style>
