<script setup lang="ts">
import type {
  AdminResourcePackage,
  QuotaTariff,
  ResourcePackageDraft,
} from '@t-box/shared'
import { onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminTextarea from '../components/AdminTextarea.vue'
import { errorMessage, request, save } from '../core/api'

const packages = ref<AdminResourcePackage[]>([])
const tariff = ref<QuotaTariff | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const dialog = ref<'product' | 'tariff' | 'publish' | null>(null)
const selected = ref<AdminResourcePackage | null>(null)
const empty = (): ResourcePackageDraft => ({
  code: '',
  name: '',
  price: '9.90',
  quota: '500',
  bonusQuota: '0',
  validDays: 180,
  description: '',
  sort: 0,
  enabled: true,
})
const productForm = reactive(empty())
const tariffForm = ref<Omit<QuotaTariff, 'version' | 'publishedAt'> | null>(
  null,
)
let tariffVersion = 0
function hasDraftChanges(row: AdminResourcePackage) {
  return (
    !row.published ||
    (Object.keys(row.draft) as (keyof ResourcePackageDraft)[]).some(
      (key) => row.draft[key] !== row.published![key],
    )
  )
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [p, t] = await Promise.all([
      request<AdminResourcePackage[]>('/billing/packages'),
      request<QuotaTariff>('/billing/tariff'),
    ])
    packages.value = p
    tariff.value = t
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}
function edit(row?: AdminResourcePackage) {
  selected.value = row ?? null
  Object.assign(productForm, row?.draft ?? empty())
  formError.value = ''
  dialog.value = 'product'
}
function editTariff() {
  if (!tariff.value) {
    return
  }
  const { version, publishedAt: _at, ...configuration } = tariff.value
  tariffVersion = version
  tariffForm.value = JSON.parse(JSON.stringify(configuration))
  formError.value = ''
  dialog.value = 'tariff'
}
function publish(row: AdminResourcePackage) {
  selected.value = row
  formError.value = ''
  dialog.value = 'publish'
}
async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  formError.value = ''
  try {
    if (dialog.value === 'product') {
      if (selected.value) {
        await save(
          `/billing/packages/${selected.value.id}`,
          { draft: productForm, revision: selected.value.revision },
          'PATCH',
        )
      } else {
        await save('/billing/packages', productForm)
      }
    } else if (dialog.value === 'tariff') {
      await save(
        '/billing/tariff',
        { configuration: tariffForm.value, version: tariffVersion },
        'PUT',
      )
    } else if (dialog.value === 'publish' && selected.value) {
      await save(`/billing/packages/${selected.value.id}/publish`, {
        revision: selected.value.revision,
      })
    }
    dialog.value = null
    await load()
  } catch (cause) {
    formError.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">AI RESOURCES</p>
      <h1>资源包与费率</h1>
      <p>
        人民币售价、用户额度与上游成本分别管理。修改草稿后发布，不影响已购权益。
      </p>
    </div>
    <div class="actions">
      <AdminButton :disabled="loading" @click="load">刷新</AdminButton><AdminButton class="primary" @click="edit()">新增资源包</AdminButton>
    </div>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >{{ error }}</p>
  <section class="panel">
    <div class="panel-heading">
      <h2>资源包商品</h2>
      <span class="muted">发布时校验优惠梯度</span>
    </div>
    <div v-if="loading" class="empty">正在读取配置…</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>资源包</th>
            <th>人民币售价</th>
            <th>额度 / 赠送</th>
            <th>有效天数</th>
            <th>在售版本</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in packages" :key="p.id">
            <td>
              <strong>{{ p.draft.name }}</strong><span class="cell-secondary">{{ p.draft.code }}</span>
            </td>
            <td>¥{{ p.draft.price }}</td>
            <td>{{ p.draft.quota }} / {{ p.draft.bonusQuota }}</td>
            <td>{{ p.draft.validDays }}</td>
            <td>
              <span
                class="badge"
                :class="{ disabled: !p.published?.enabled }"
              >{{
                p.published
                  ? `v${p.published.version} · ${p.published.enabled ? '已上架' : '已下架'}`
                  : '未发布'
              }}</span><span
                v-if="p.published && hasDraftChanges(p)"
                class="cell-secondary"
              >有待发布修改</span>
            </td>
            <td class="actions">
              <AdminButton @click="edit(p)">编辑草稿</AdminButton><AdminButton @click="publish(p)">发布版本</AdminButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <section v-if="tariff" class="panel tariff-overview">
    <div class="panel-heading">
      <h2>
        公开费率 v{{ tariff.version }}
        <span class="badge" :class="{ disabled: !tariff.enabled }">{{
          tariff.enabled ? '已启用' : '未启用'
        }}</span>
      </h2>
      <AdminButton @click="editTariff">配置并发布费率</AdminButton>
    </div>
    <dl class="tariff-grid">
      <div>
        <dt>文本输入 / 百万 token</dt>
        <dd>{{ tariff.inputPerMillion }} 额度</dd>
      </div>
      <div>
        <dt>文本输出 / 百万 token</dt>
        <dd>{{ tariff.outputPerMillion }} 额度</dd>
      </div>
      <div>
        <dt>缓存输入 / 百万 token</dt>
        <dd>{{ tariff.cachedInputPerMillion }} 额度</dd>
      </div>
      <div>
        <dt>单任务上限</dt>
        <dd>{{ tariff.taskLimit }} 额度 · {{ tariff.imageLimit }} 张图片</dd>
      </div>
      <div v-for="tier in ['1k', '2k', '4k'] as const" :key="tier">
        <dt>{{ tier.toUpperCase() }} 生成 / 编辑</dt>
        <dd>{{ tariff.images[tier] }} / {{ tariff.edits[tier] }} 额度</dd>
      </div>
    </dl>
    <p class="footnote">
      初始文本费率仅为草案，确认后启用。新费率用于新任务，进行中的任务保持原快照。标题、记忆整理、自动压缩不扣用户额度。
    </p>
  </section>
  <AdminDialog
    :open="dialog !== null"
    :title="
      dialog === 'product'
        ? selected
          ? '编辑资源包草稿'
          : '新增资源包'
        : dialog === 'tariff'
          ? '发布公开费率'
          : '确认发布资源包'
    "
    :busy="busy"
    @close="dialog = null"
  >
    <p
      v-if="formError"
      class="alert"
      role="alert"
    >{{ formError }}</p>
    <form
      id="quota-config-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <template v-if="dialog === 'product'">
          <div class="form-grid">
            <label>商品编码<AdminInput
              v-model="productForm.code"
              :disabled="!!selected"
              required
              pattern="[a-z][a-z0-9-]{1,39}"
              maxlength="40"
            /></label><label>名称<AdminInput
              v-model="productForm.name"
              required
              maxlength="60"
            /></label><label>售价 / 元<AdminInput
              v-model="productForm.price"
              required
              inputmode="decimal"
              pattern="[0-9]+([.][0-9]{1,2})?"
            /><small>最低 ¥0.01，最多两位小数。</small></label><label>基础额度<AdminInput
              v-model="productForm.quota"
              required
              inputmode="numeric"
              pattern="[0-9]+"
            /></label><label>赠送额度<AdminInput
              v-model="productForm.bonusQuota"
              required
              inputmode="numeric"
              pattern="[0-9]+"
            /></label><label>有效天数<AdminInput
              v-model.number="productForm.validDays"
              type="number"
              min="1"
              max="3650"
              required
            /></label><label>排序<AdminInput
              v-model.number="productForm.sort"
              type="number"
              min="0"
              max="10000"
              required
            /></label>
          </div>
          <label>说明<AdminTextarea
            v-model="productForm.description"
            maxlength="500"
            rows="3"
          /></label><label class="check-row"><AdminCheckbox
            v-model="productForm.enabled"
          />发布后上架</label>
          <p class="footnote">
            编码创建后不能修改。保存仅更新草稿，点击发布版本后生效。
          </p>
        </template>
        <template v-else-if="dialog === 'tariff' && tariffForm">
          <label class="check-row"><AdminCheckbox
            v-model="tariffForm.enabled"
          />启用公开费率</label>
          <div class="form-grid">
            <label>输入 / 百万 token<AdminInput
              v-model="tariffForm.inputPerMillion"
              inputmode="decimal"
              required
            /></label><label>输出 / 百万 token<AdminInput
              v-model="tariffForm.outputPerMillion"
              inputmode="decimal"
              required
            /></label><label>缓存输入 / 百万 token<AdminInput
              v-model="tariffForm.cachedInputPerMillion"
              inputmode="decimal"
              required
            /></label><label>单任务额度上限<AdminInput
              v-model="tariffForm.taskLimit"
              inputmode="decimal"
              required
            /></label><label>单任务图片张数<AdminInput
              v-model.number="tariffForm.imageLimit"
              type="number"
              min="1"
              max="20"
              required
            /></label>
          </div>
          <div
            v-for="tier in ['1k', '2k', '4k'] as const"
            :key="tier"
            class="form-grid"
          >
            <label>{{ tier.toUpperCase() }} 生成 / 张<AdminInput
              v-model="tariffForm.images[tier]"
              inputmode="numeric"
              required
            /></label><label>{{ tier.toUpperCase() }} 编辑 / 张<AdminInput
              v-model="tariffForm.edits[tier]"
              inputmode="numeric"
              required
            /></label>
          </div>
          <p class="footnote">
            价格单位均为额度。发布将创建新版本；模型服务的采购报价在模型页面单独配置。
          </p>
        </template>
        <template v-else-if="selected"><p>
                                         发布「{{ selected.draft.name }}」v{{
                                           (selected.published?.version ?? 0) + 1
                                         }}：¥{{ selected.draft.price }}，{{ selected.draft.quota }} 额度，赠
                                         {{ selected.draft.bonusQuota }}，有效
                                         {{ selected.draft.validDays }} 天。
                                       </p>
          <p>
            {{
              selected.draft.enabled ? '发布后可购买。' : '发布后下架。'
            }}已付款订单与已发放资源包保持原权益。
          </p></template>
      </fieldset>
    </form>
    <template #footer><AdminButton :disabled="busy" @click="dialog = null">取消</AdminButton><AdminButton
      class="primary"
      type="submit"
      form="quota-config-form"
      :disabled="busy"
    >
      {{
        busy ? '正在保存…' : dialog === 'product' ? '保存草稿' : '确认发布'
      }}
    </AdminButton></template>
  </AdminDialog>
</template>

<style scoped>
.tariff-overview {
  margin-top: 22px;
}
.tariff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 20px;
  padding: 20px;
  margin: 0;
}
.tariff-grid dt {
  color: var(--muted);
  font-size: 12px;
}
.tariff-grid dd {
  margin: 8px 0 0;
  font-variant-numeric: tabular-nums;
  font-size: 16px;
}
</style>
