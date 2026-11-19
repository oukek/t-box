<script setup lang="ts">
import type { Config, Coupon, Route } from '@t-box/shop-tools-contracts'
import { clone, validateCoupons } from '@t-box/shop-tools-core'
import { computed, ref } from 'vue'
import EditDialog from './EditDialog.vue'

const props = defineProps<{ config: Config, routes: Route[] }>()
const emit = defineEmits<{ save: [value: Config], reload: [] }>()
const basicOpen = ref(false)
const siteOpen = ref(false)
const error = ref('')
const basic = ref<Config['basic']>({})
const site = ref('')
const draft = ref<{
  enabled: boolean
  precision?: number | string
  coupons?: Coupon[]
  disabled: string[]
}>({ enabled: true, disabled: [] })
const fields = [
  ['weight', '默认重量（kg）'],
  ['domestic', '境内运费（CNY）'],
  ['activity', '活动费（%）'],
  ['withdraw', '提现费（%）'],
  ['discount', '折扣（%）'],
  ['loss', '预留汇损（%）'],
  ['precision', '价格小数位（0–6）'],
] as const
const sites = computed(() =>
  [
    ...new Map(
      props.routes.map((r) => [r.site, { id: r.site, name: r.siteName }]),
    ).values(),
  ].sort((a, b) => {
    const index = (s: string) => {
      const n = props.config.order.indexOf(s)
      return n < 0 ? 999 : n
    }
    return index(a.id) - index(b.id)
  }),
)
const paths = computed(() => {
  const nodes = new Map<string, { id: string, label: string, depth: number }>()
  for (const r of props.routes.filter((r) => r.site === site.value)) {
    for (let i = 0; i < 3; i++) {
      const id = JSON.stringify(r.path.slice(0, i + 1))
      nodes.set(id, { id, label: [r.cargo, r.channel, r.region][i]!, depth: i })
    }
  }
  return [...nodes.values()]
})
function openBasic() {
  basic.value = clone(props.config.basic)
  error.value = ''
  basicOpen.value = true
}
function saveBasic() {
  error.value = ''
  for (const [key] of fields) {
    const v = basic.value[key]
    const n = Number(v)
    if (key === 'precision') {
      if (String(v).trim() === '' || !Number.isInteger(n) || n < 0 || n > 6) {
        error.value = '小数位须为0–6的整数'
      }
    } else if (key === 'weight' || key === 'domestic') {
      if (
        v !== '' &&
        (!Number.isFinite(n) || n < 0 || (key === 'weight' && n === 0))
      ) {
        error.value = '重量须大于0，运费不能为负数'
      }
    } else if (
      String(v).trim() === '' ||
      !Number.isFinite(n) ||
      n < 0 ||
      n >= 100
    ) {
      error.value = '费率须为0至100之间（不含100）'
    }
  }
  if (error.value) {
    return
  }
  emit('save', { ...clone(props.config), basic: clone(basic.value) })
  basicOpen.value = false
}
function openSite(id: string) {
  site.value = id
  draft.value = clone(props.config.sites[id] || { enabled: true, disabled: [] })
  draft.value.coupons ??= []
  error.value = ''
  siteOpen.value = true
}
function toggle(id: string, enabled: boolean) {
  draft.value.disabled = draft.value.disabled.filter((p) => p !== id)
  if (!enabled) {
    draft.value.disabled.push(id)
  }
}
function saveSite() {
  const p = draft.value.precision
  if (
    p !== undefined &&
    p !== '' &&
    (!Number.isInteger(Number(p)) || Number(p) < 0 || Number(p) > 6)
  ) {
    error.value = '小数位须为0–6的整数'
    return
  }
  let coupons: Coupon[]
  try { coupons = validateCoupons(draft.value.coupons) }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    return
  }
  const value = clone(props.config)
  value.sites[site.value] = {
    coupons,
    enabled: draft.value.enabled,
    disabled: clone(draft.value.disabled),
    ...(p === undefined || p === '' ? {} : { precision: Number(p) }),
  }
  emit('save', value)
  siteOpen.value = false
}
function move(index: number, delta: number) {
  const order = sites.value.map((s) => s.id)
  ;[order[index], order[index + delta]] = [order[index + delta]!, order[index]!]
  emit('save', {
    ...clone(props.config),
    order: [...order, ...props.config.order.filter((s) => !order.includes(s))],
  })
}
function setAll(enabled: boolean) {
  draft.value.enabled = enabled
  draft.value.disabled = enabled ? [] : paths.value.map((p) => p.id)
}
</script>

<template>
  <p class="muted">设置常用参数与参与计算的物流方案，修改后仅影响后续计算。</p>
  <section class="panel config-section">
    <div class="toolbar">
      <h2>默认参数</h2>
      <button @click="openBasic">编辑参数</button>
    </div>
    <dl class="summary">
      <div v-for="[key, label] in fields" :key="key">
        <dt>{{ label }}</dt>
        <dd>{{ config.basic[key] === '' ? '未设置' : config.basic[key] }}</dd>
      </div>
    </dl>
  </section>
  <section class="panel config-section">
    <div class="toolbar">
      <div>
        <h2>站点与物流</h2>
        <small>新站点与新方案默认启用；排序决定方案顺序。</small>
      </div>
      <button @click="emit('reload')">重新加载</button>
    </div>
    <p v-if="!sites.length" class="notice">
      尚无站点数据，请连接数据服务后重新加载；默认参数仍可编辑。
    </p>
    <div
      v-for="(s, index) in sites"
      :key="s.id"
      class="site-row"
    >
      <div class="site-name">
        <span class="country-code">{{ s.id }}</span>
        <div>
          <strong>{{ s.name }}</strong><small>{{
            config.sites[s.id]?.enabled === false ? '已停用' : '已启用'
          }} · {{ config.sites[s.id]?.coupons?.length || 0 }} 张优惠券</small>
        </div>
      </div>
      <div class="actions">
        <button
          :disabled="index === 0"
          :aria-label="`上移${s.name}`"
          @click="move(index, -1)"
        >
          ↑</button><button
          :disabled="index === sites.length - 1"
          :aria-label="`下移${s.name}`"
          @click="move(index, 1)"
        >
          ↓</button><button @click="openSite(s.id)">配置</button>
      </div>
    </div>
  </section>
  <EditDialog
    :open="basicOpen"
    long
    title="编辑默认参数"
    @close="basicOpen = false"
    @save="saveBasic"
  ><p
     v-if="error"
     role="alert"
     class="error-text"
   >{{ error }}</p>
    <div class="fields two-columns">
      <label
        v-for="[key, label] in fields"
        :key="key"
      >{{ label
      }}<input
        v-model="basic[key]"
        type="number"
        min="0"
        :step="key === 'precision' ? '1' : 'any'"
      ></label></div></EditDialog>
  <EditDialog
    :open="siteOpen"
    :title="`${sites.find((s) => s.id === site)?.name || site}站点配置`"
    long
    @close="siteOpen = false"
    @save="saveSite"
  ><p
     v-if="error"
     role="alert"
     class="error-text"
   >{{ error }}</p>
    <div class="toolbar">
      <label><input v-model="draft.enabled" type="checkbox">启用该站点</label>
      <div class="actions">
        <button @click="setAll(true)">全部开启</button><button @click="setAll(false)">全部关闭</button>
      </div>
    </div>
    <label class="field">价格小数位（留空继承默认 {{ config.basic.precision }} 位）<input
      v-model="draft.precision"
      type="number"
      min="0"
      max="6"
      step="1"
    ></label>
    <div class="toolbar">
      <strong>站点满减券（{{ routes.find(r => r.site === site)?.currency }}）</strong>
      <button @click="draft.coupons?.push({ threshold: 0, reduction: 0 })">添加优惠券</button>
    </div>
    <p class="muted">按单件折后商品价判断门槛，同时满足多张券时使用减免最大的一张。按售价模式保留目标折后价，显示用券后的实际利润。</p>
    <div v-for="(coupon, index) in draft.coupons" :key="index" class="toolbar">
      <label class="field">满<input v-model.number="coupon.threshold" type="number" min="0" step="any"></label>
      <label class="field">减<input v-model.number="coupon.reduction" type="number" min="0" step="any"></label>
      <button @click="draft.coupons?.splice(index, 1)">移除</button>
    </div>
    <div
      v-for="p in paths"
      :key="p.id"
      class="path-row"
      :style="{ paddingLeft: `${p.depth * 20}px` }"
    >
      <label><input
        type="checkbox"
        :checked="!draft.disabled.includes(p.id)"
        :disabled="!draft.enabled"
        @change="toggle(p.id, ($event.target as HTMLInputElement).checked)"
      >{{ p.label }}</label>
    </div></EditDialog>
</template>
