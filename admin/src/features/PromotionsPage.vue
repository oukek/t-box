<script setup lang="ts">
import type { PromotionChannel, PromotionChannelDraft } from '@t-box/shared'
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminInput from '../components/AdminInput.vue'
import { apiBase, errorMessage, request, save } from '../core/api'

const channels = ref<PromotionChannel[]>([])
const search = ref('')
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const dialogError = ref('')
const notice = ref('')
const editing = ref(false)
const selected = ref<PromotionChannel | null>(null)
const preview = ref<PromotionChannel | null>(null)
const imageError = ref(false)
const draft = reactive<PromotionChannelDraft>({ name: '', descriptionNote: '', enabled: true })
let revision = 0
const posterUrl = (channel: PromotionChannel) => apiBase + channel.posterPath

async function load() {
  const active = ++revision
  loading.value = true
  error.value = ''
  try {
    const result = await request<{ items: PromotionChannel[], total: number }>(
      '/promotions/channels?' + new URLSearchParams({ search: search.value, page: String(page.value) }),
    )
    if (active === revision) {
      channels.value = result.items
      total.value = result.total
    }
  } catch (cause) {
    if (active === revision) {
      error.value = errorMessage(cause)
    }
  } finally {
    if (active === revision) {
      loading.value = false
    }
  }
}

function edit(channel: PromotionChannel | null = null) {
  selected.value = channel
  Object.assign(draft, { name: channel?.name ?? '', descriptionNote: channel?.descriptionNote ?? '', enabled: channel?.enabled ?? true, revision: channel?.revision })
  dialogError.value = ''
  editing.value = true
}

async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    await save('/promotions/channels' + (selected.value ? '/' + selected.value.id : ''), draft, selected.value ? 'PATCH' : 'POST')
    editing.value = false
    notice.value = selected.value ? '推广渠道已保存' : '推广渠道已创建'
    await load()
  } catch (cause) {
    dialogError.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function copy(channel: PromotionChannel) {
  error.value = ''
  notice.value = ''
  try {
    await navigator.clipboard.writeText(channel.shareUrl)
    notice.value = '已复制「' + channel.name + '」推广链接'
  } catch {
    openPreview(channel)
    notice.value = '请在预览窗口中选中链接并复制'
  }
}

function openPreview(channel: PromotionChannel) {
  preview.value = channel
  imageError.value = false
}

function find() {
  page.value = 1
  void load()
}

onMounted(load)
onBeforeUnmount(() => revision++)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">推广管理</p>
      <h1>推广渠道</h1>
      <p>为不同宣传途径生成专属链接和海报，追踪带来的新用户与支付。</p>
    </div>
    <AdminButton class="primary" @click="edit()"><AdminIcon name="plus" :size="16" />创建渠道</AdminButton>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >{{ error }}</p>
  <p
    v-if="notice"
    class="success"
    role="status"
  >{{ notice }}</p>
  <section class="panel">
    <div class="panel-heading">
      <h2>宣传途径 <span class="count">{{ total }}</span></h2>
      <form class="promotion-search" @submit.prevent="find">
        <AdminInput
          v-model="search"
          aria-label="搜索推广渠道"
          placeholder="搜索渠道名称"
          maxlength="80"
        />
        <AdminButton type="submit" :disabled="loading">搜索</AdminButton>
        <AdminButton :disabled="loading" @click="load">刷新</AdminButton>
      </form>
    </div>
    <div v-if="loading" class="empty">正在读取推广渠道…</div>
    <div v-else-if="!channels.length" class="empty">暂无匹配渠道。创建渠道后即可复制专属链接、下载带二维码的海报。</div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>渠道 / 宣传途径</th><th>状态</th><th>首次注册</th><th>支付总金额</th><th>退款 / 净支付</th><th class="actions-heading">操作</th></tr></thead>
        <tbody>
          <tr v-for="channel in channels" :key="channel.id">
            <td><strong>{{ channel.name }}</strong><span v-if="channel.descriptionNote" class="cell-secondary">{{ channel.descriptionNote }}</span></td>
            <td><span class="badge" :class="{ disabled: !channel.enabled }">{{ channel.enabled ? '推广中' : '已停用' }}</span></td>
            <td class="mono">{{ channel.registrations }}<span class="cell-secondary">{{ channel.payingUsers }} 人付费</span></td>
            <td class="mono">¥{{ channel.paidAmount }}</td>
            <td class="mono">¥{{ channel.refundedAmount }}<span class="cell-secondary">净支付 ¥{{ channel.netAmount }}</span></td>
            <td class="actions">
              <AdminButton @click="edit(channel)">编辑</AdminButton>
              <AdminButton :disabled="!channel.enabled" @click="copy(channel)">复制链接</AdminButton>
              <AdminButton :disabled="!channel.enabled" @click="openPreview(channel)">宣传图</AdminButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="total > 50" class="promotion-pagination">
      <AdminButton :disabled="page === 1 || loading" @click="page--; load()">上一页</AdminButton>
      <span>第 {{ page }} / {{ Math.ceil(total / 50) }} 页</span>
      <AdminButton :disabled="page * 50 >= total || loading" @click="page++; load()">下一页</AdminButton>
    </div>
  </section>
  <p class="footnote">来源仅在首次注册时固定，老用户再次扫码不计入。支付总金额累计这些新用户的全部成功支付，退款单独列示；停用渠道不影响历史统计。推广网站使用「微信登录」中配置的网站地址。</p>
  <AdminDialog
    :open="editing"
    :title="selected ? '编辑推广渠道' : '创建推广渠道'"
    :busy="busy"
    @close="editing = false"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >{{ dialogError }}</p>
    <form
      id="promotion-channel-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <label>渠道名称<AdminInput
        v-model="draft.name"
        placeholder="例如：公众号、社群、线下海报"
        maxlength="80"
        required
      /></label>
      <label>宣传途径说明<AdminInput
        v-model="draft.descriptionNote"
        placeholder="填写投放位置、活动或社群名称，方便识别"
        maxlength="300"
      /></label>
      <label><AdminCheckbox v-model="draft.enabled" />启用推广<small>停用后不再记录通过该渠道首次注册的新用户。</small></label>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="editing = false">取消</AdminButton>
      <AdminButton
        class="primary"
        type="submit"
        form="promotion-channel-form"
        :disabled="busy"
      >{{ busy ? '正在保存…' : '保存渠道' }}</AdminButton>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="!!preview"
    :title="preview ? preview.name + ' · 宣传图' : '宣传图'"
    @close="preview = null"
  >
    <template v-if="preview">
      <p
        v-if="imageError"
        class="alert"
        role="alert"
      >海报加载失败，请检查渠道是否已停用，然后重新打开。</p>
      <img
        v-else
        class="promotion-poster-preview"
        :src="posterUrl(preview)"
        alt="带渠道专属二维码的 T方舟宣传海报"
        width="1080"
        height="1920"
        @error="imageError = true"
      >
      <label class="promotion-link-label">推广链接<AdminInput
        class="admin-control"
        :model-value="preview.shareUrl"
        readonly
        aria-label="渠道推广链接"
        @focus="($event.target as HTMLInputElement).select()"
      /></label>
    </template>
    <template #footer>
      <AdminButton v-if="preview" @click="copy(preview)">复制链接</AdminButton>
      <a
        v-if="preview && !imageError"
        class="admin-button primary"
        :href="posterUrl(preview) + '?download=1'"
        download="t-ark-poster.png"
      >下载宣传图</a>
    </template>
  </AdminDialog>
</template>

<style scoped>
.promotion-search,
.promotion-pagination {
  display: flex;
  align-items: center;
  gap: 10px;
}
.promotion-search {
  flex-wrap: wrap;
}
.promotion-search input {
  width: min(240px, 100%);
}
.promotion-pagination {
  justify-content: flex-end;
  padding: 18px;
  font-size: 12px;
}
.promotion-poster-preview {
  display: block;
  width: min(100%, 340px);
  height: auto;
  margin: 0 auto 20px;
  border-radius: 10px;
  background: #082b26;
}
.promotion-link-label {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: #647781;
}
.promotion-link-label input {
  width: 100%;
  font-size: 12px;
}
.promotion-poster-preview + .promotion-link-label {
  margin-top: 16px;
}
a.admin-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 13px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  text-decoration: none;
}
@media (max-width: 640px) {
  .promotion-search {
    width: 100%;
  }
}
</style>
