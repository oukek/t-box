<script setup lang="ts">
import type { BillingMode, BillingUser, UsageRecord } from '@t-box/shared'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request, save } from '../core/api'

const users = ref<BillingUser[]>([])
const query = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const selected = ref<BillingUser | null>(null)
const operation = ref<'mode' | 'grant' | 'usage' | null>(null)
const mode = ref<BillingMode>('charge')
const amount = ref('500')
const validDays = ref(180)
const reason = ref('')
const dialogError = ref('')
const records = ref<UsageRecord[]>([])
const recordsLoading = ref(false)
const release = ref<UsageRecord | null>(null)
const reviewAction = ref<'release' | 'settle'>('release')
let grantKey = crypto.randomUUID()
const filtered = computed(() =>
  users.value.filter((u) =>
    `${u.nickname} ${u.username}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
)
const states = {
  reserved: '处理中',
  settled: '已结算',
  review: '待核对',
  released: '已确认免扣',
  reversed: '失败已冲正',
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
let loadRevision = 0
async function load() {
  const revision = ++loadRevision
  loading.value = true
  error.value = ''
  try {
    const items = await request<BillingUser[]>(
      `/billing/users?search=${encodeURIComponent(query.value.trim())}`,
    )
    if (revision === loadRevision) {
      users.value = items
    }
  } catch (e) {
    if (revision === loadRevision) {
      error.value = errorMessage(e)
    }
  } finally {
    if (revision === loadRevision) {
      loading.value = false
    }
  }
}
async function edit(user: BillingUser, action: typeof operation.value) {
  selected.value = user
  operation.value = action
  mode.value = user.mode
  reason.value = ''
  amount.value = '500'
  validDays.value = 180
  dialogError.value = ''
  release.value = null
  grantKey = crypto.randomUUID()
  records.value = []
  if (action === 'usage') {
    recordsLoading.value = true
    try {
      records.value = await request<UsageRecord[]>(
        `/billing/users/${user.id}/usage`,
      )
    } catch (e) {
      dialogError.value = errorMessage(e)
    } finally {
      recordsLoading.value = false
    }
  }
}
async function submit() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    const path = `/billing/users/${selected.value.id}`
    if (operation.value === 'mode') {
      await save(path, { mode: mode.value, reason: reason.value }, 'PATCH')
    }
    if (operation.value === 'grant') {
      await request(`${path}/grants`, {
        method: 'POST',
        headers: { 'Idempotency-Key': grantKey },
        body: JSON.stringify({
          amount: amount.value,
          reason: reason.value,
          validDays: validDays.value,
        }),
      })
    }
    if (operation.value === 'usage' && release.value) {
      await save(`${path}/usage/${release.value.id}/${reviewAction.value}`, {
        reason: reason.value,
      })
      release.value = null
      reason.value = ''
      records.value = await request<UsageRecord[]>(`${path}/usage`)
    } else {
      operation.value = null
    }
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
watch(query, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
})
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  loadRevision++
})
onMounted(load)
function startReview(record: UsageRecord, action: 'release' | 'settle') {
  reviewAction.value = action
  release.value = record
  reason.value = ''
}
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">BILLING</p>
      <h1>用户与额度</h1>
      <p>配置用户扣费方式，查看实际用量与费用。</p>
    </div>
    <button :disabled="loading" @click="load">刷新</button>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
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
        >
      </div>
    </div>
    <div v-if="loading" class="empty">正在读取账户…</div>
    <div v-else-if="!filtered.length" class="empty">暂无匹配用户</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>总额度</th>
            <th>可用额度</th>
            <th>扣费方式</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <strong>{{ u.nickname }}</strong><span class="cell-secondary">@{{ u.username }}</span>
            </td>
            <td>
              {{ u.balance
              }}<span
                v-if="u.reserved !== '0.0000'"
                class="cell-secondary"
              >预留 {{ u.reserved }}</span>
            </td>
            <td>{{ u.available }}</td>
            <td>
              <span
                class="badge"
                :class="{ disabled: u.mode === 'record_only' }"
              >{{ u.mode === 'charge' ? '实际扣额度' : '免费用户' }}</span>
            </td>
            <td class="actions">
              <button @click="edit(u, 'usage')">使用记录</button><button @click="edit(u, 'mode')">扣费设置</button><button @click="edit(u, 'grant')">赠送额度</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p class="footnote">
    列表最多显示 100
    位匹配用户，可搜索任意已注册账号。免费用户不预占、不扣额度。设置从下一次调用生效，进行中的调用保留原模式。余额赠送会记录管理员、原因和流水，独立于付费资源包。
  </p>
  <AdminDialog
    :open="!!operation"
    :title="
      operation === 'mode'
        ? '扣费设置'
        : operation === 'grant'
          ? '赠送额度'
          : '使用记录'
    "
    :description="
      selected ? `${selected.nickname} · @${selected.username}` : ''
    "
    :busy="busy"
    @close="operation = null"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      v-if="operation !== 'usage'"
      id="billing-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <label v-if="operation === 'mode'">扣费方式<AdminSelect
          v-model="mode"
          label="扣费方式"
          :options="[
            { value: 'charge', label: '实际扣额度' },
            { value: 'record_only', label: '免费用户：记录用量，不扣额度' },
          ]"
        /></label>
        <label v-else>赠送额度<input
          v-model="amount"
          inputmode="decimal"
          pattern="[0-9]+([.][0-9]{1,4})?"
          required
        ></label>
        <label v-if="operation === 'grant'">有效天数<input
          v-model.number="validDays"
          type="number"
          min="1"
          max="3650"
          required
        ></label>
        <label>调整原因<input
          v-model="reason"
          maxlength="200"
          placeholder="必填，保留操作审计"
          required
        ></label>
      </fieldset>
    </form>
    <template v-else>
      <p class="footnote">
        最近 100 次调用。标题、记忆整理及上下文压缩由平台承担。
      </p>
      <p v-if="recordsLoading" class="empty">正在读取…</p>
      <p v-else-if="!records.length" class="empty">暂无使用记录</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>服务 / 状态</th>
              <th>用量</th>
              <th>应扣 / 实扣额度</th>
              <th>核对</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>
                {{ r.kind === 'image' ? '图片处理' : 'AI 会话'
                }}<span class="cell-secondary">{{ states[r.status] }} ·
                  {{ new Date(r.createdAt).toLocaleString() }}</span>
              </td>
              <td>
                {{
                  r.kind === 'image'
                    ? `${r.images ?? '—'} 张`
                    : `输入 ${r.inputTokens ?? '—'} / 输出 ${r.outputTokens ?? '—'}`
                }}
              </td>
              <td>
                {{ r.fee }} / {{ r.charged
                }}<span
                  v-if="r.mode === 'record_only'"
                  class="cell-secondary"
                >免费用户</span>
              </td>
              <td>
                <button
                  v-if="r.status === 'review'"
                  :disabled="busy"
                  @click="startReview(r, 'release')"
                >
                  确认免扣</button><button
                  v-if="
                    r.status === 'review'
                      && (r.kind === 'image'
                        ? r.images !== null
                        : r.inputTokens !== null && r.outputTokens !== null)
                  "
                  :disabled="busy"
                  @click="startReview(r, 'settle')"
                >
                  确认核对完成
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
            reviewAction === 'release'
              ? '确认免扣会放弃本条用户扣费，请确认服务商结果并填写原因。'
              : '确认已核对服务商用量，不再补扣用户额度。'
          }}不会重新调用模型。
        </p>
        <label>核对原因<input
          v-model="reason"
          maxlength="200"
          required
        ></label>
      </form>
    </template>
    <template #footer>
      <button :disabled="busy" @click="operation = null">关闭</button><button
        v-if="operation !== 'usage' || release"
        form="billing-form"
        class="primary"
        type="submit"
        :disabled="busy"
      >
        {{ busy ? '正在保存…' : '确认保存' }}
      </button>
    </template>
  </AdminDialog>
</template>
