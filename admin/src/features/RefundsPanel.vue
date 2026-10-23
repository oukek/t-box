<script setup lang="ts">
import type { AdminPaymentOrder, PaymentRefund } from '@t-box/shared'
import { computed, onMounted, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request } from '../core/api'

const props = defineProps<{ orders: AdminPaymentOrder[] }>()
const emit = defineEmits<{ updated: [] }>()
const refunds = ref<PaymentRefund[]>([])
const open = ref(false)
const busy = ref(false)
const error = ref('')
const dialogError = ref('')
const orderId = ref('')
const reason = ref('')
let requestKey = crypto.randomUUID()
const selected = computed(() =>
  props.orders.find((order) => order.id === orderId.value),
)
const choices = computed(() =>
  props.orders
    .filter(
      (order) =>
        order.status === 'paid' &&
        !refunds.value.some(
          (refund) => refund.orderId === order.id && refund.status !== 'closed',
        ),
    )
    .map((order) => ({
      value: order.id,
      label: `${order.nickname} · ¥${Number(order.amount)} · ${order.id.slice(0, 8)}`,
    })),
)
const labels: Record<string, string> = {
  prepared: '待提交',
  processing: '渠道处理中',
  uncertain: '结果待核对',
  abnormal: '渠道异常',
  succeeded: '已退款',
  closed: '退款已关闭',
}
async function load() {
  try {
    refunds.value = await request<PaymentRefund[]>('/payments/refunds')
  } catch (e) {
    error.value = errorMessage(e)
  }
}
function begin() {
  orderId.value = ''
  reason.value = ''
  dialogError.value = ''
  requestKey = crypto.randomUUID()
  open.value = true
}
async function submit() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    await request(`/payments/orders/${selected.value.id}/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestKey },
      body: JSON.stringify({ reason: reason.value.trim() }),
    })
    open.value = false
    await load()
    emit('updated')
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function reconcile(id: string) {
  busy.value = true
  error.value = ''
  try {
    await request(`/payments/refunds/${id}/reconcile`, {
      method: 'POST',
      body: '{}',
    })
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
  <section class="refund-panel">
    <div class="refund-heading">
      <div>
        <h2>退款记录</h2>
        <p class="muted">
          按原订单未使用权益比例退回人民币，并收回对应额度（含赠送）。
        </p>
      </div>
      <div class="actions">
        <button :disabled="busy" @click="load">刷新</button><button @click="begin">发起退款</button>
      </div>
    </div>
    <p
      v-if="error"
      class="alert"
      role="alert"
    >{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>订单 / 退款单</th>
            <th>原路退款 / 收回额度</th>
            <th>状态</th>
            <th>原因</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="refund in refunds" :key="refund.id">
            <td>
              <code>{{ refund.orderId }}</code><small>{{ refund.id }}</small>
            </td>
            <td>
              ¥{{ Number(refund.amount)
              }}<small>收回 {{ Number(refund.reclaimedQuota) }} 额度</small>
            </td>
            <td>
              {{ labels[refund.status]
              }}<small v-if="refund.error">{{ refund.error }}</small>
            </td>
            <td>{{ refund.reason }}</td>
            <td>
              <button
                v-if="!['succeeded', 'closed'].includes(refund.status)"
                :disabled="busy"
                @click="reconcile(refund.id)"
              >
                核对原退款单
              </button>
            </td>
          </tr>
          <tr v-if="!refunds.length">
            <td colspan="5" class="muted">暂无退款记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AdminDialog
    :open="open"
    title="申请资源包退款"
    :busy="busy"
    @close="open = false"
  >
    <form
      id="refund-form"
      class="refund-form"
      @submit.prevent="submit"
    >
      <label>已支付订单<AdminSelect
        v-model="orderId"
        :options="choices"
        label="已支付订单"
        placeholder="选择订单"
      /></label>
      <label>退款原因<input
        v-model="reason"
        required
        maxlength="26"
        placeholder="最多 26 个字"
      ></label>
      <div v-if="selected" class="refund-summary">
        <span>原实付金额<strong>¥{{ Number(selected.amount) }}</strong></span><span>原基础 / 赠送额度<strong>{{ selected.quota }} / {{ selected.bonusQuota }}</strong></span>
      </div>
      <p class="muted">
        仅退款原订单未使用的权益，实际退款金额由后台按比例计算，向下取整到分。使用中的额度需先完成结算；提交后冻结对应权益，退款成功再收回，其他资源包不受影响。超时继续核对原退款单。
      </p>
      <p
        v-if="dialogError"
        class="alert"
        role="alert"
      >{{ dialogError }}</p>
    </form>
    <template #footer><button :disabled="busy" @click="open = false">取消</button><button
      class="danger"
      type="submit"
      form="refund-form"
      :disabled="busy || !orderId || !reason.trim()"
    >
      {{ busy ? '正在提交…' : '确认申请原路退款' }}
    </button></template>
  </AdminDialog>
</template>

<style scoped>
.refund-panel {
  margin-top: 28px;
}
.refund-heading {
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
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
code {
  font-size: 11px;
  overflow-wrap: anywhere;
}
.refund-form {
  display: grid;
  gap: 18px;
}
.refund-form label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.refund-form p {
  line-height: 1.7;
}
.refund-summary {
  display: grid;
  gap: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}
.refund-summary span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}
</style>
