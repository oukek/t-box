<script setup lang="ts">
import type { AIProviderConfig } from '@t-box/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import { errorMessage, request, save } from '../core/api'

const providers = ref<AIProviderConfig[]>([])
const error = ref('')
const dialogError = ref('')
const notice = ref('')
const busy = ref(false)
const loading = ref(true)
const editing = ref<string | null>(null)
const visible = ref(false)
const query = ref('')
const removing = ref<AIProviderConfig | null>(null)
const form = reactive({
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  enabled: true,
})
const filtered = computed(() =>
  providers.value.filter((p) =>
    `${p.name} ${p.baseUrl}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
)
async function load() {
  loading.value = true
  try {
    providers.value = await request('/providers')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
function edit(provider?: AIProviderConfig) {
  editing.value = provider?.id || null
  Object.assign(form, {
    name: provider?.name || '',
    baseUrl: provider?.baseUrl || 'https://api.openai.com/v1',
    apiKey: '',
    enabled: provider?.enabled ?? true,
  })
  visible.value = true
  dialogError.value = ''
}
function closeEditor() {
  if (busy.value) {
    return
  }
  visible.value = false
  form.apiKey = ''
}
async function submit() {
  busy.value = true
  dialogError.value = ''
  notice.value = ''
  try {
    await save(
      editing.value ? `/providers/${editing.value}` : '/providers',
      form,
      editing.value ? 'PATCH' : 'POST',
    )
    form.apiKey = ''
    visible.value = false
    notice.value = '服务商配置已保存'
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!removing.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  notice.value = ''
  try {
    await request(`/providers/${removing.value.id}`, { method: 'DELETE' })
    removing.value = null
    notice.value = '服务商已删除'
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">能力配置 / 连接</p>
      <h1>服务商管理</h1>
      <p>统一管理 API 地址与密钥，供多个模型共用。</p>
    </div>
    <button
      class="primary"
      :disabled="busy || loading"
      @click="edit()"
    >
      <AdminIcon name="plus" :size="16" />添加服务商
    </button>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <p
    v-if="notice"
    class="success"
    role="status"
  >
    {{ notice }}
  </p>
  <section class="panel">
    <div class="panel-heading">
      <h2>
        连接目录<span class="count">{{ providers.length }}</span>
      </h2>
      <div class="search-field">
        <AdminIcon name="search" :size="16" /><input
          v-model="query"
          aria-label="搜索服务商"
          placeholder="搜索名称或 API 地址"
        >
      </div>
    </div>
    <div v-if="loading" class="empty">正在读取服务商…</div>
    <div v-else-if="!providers.length" class="empty">
      <span class="empty-symbol"><AdminIcon
        name="connection"
        :size="26"
      /></span>
      <h3>连接第一个服务商</h3>
      <p>保存 API 地址和密钥，然后添加它提供的模型。</p>
      <button @click="edit()">添加服务商</button>
    </div>
    <div v-else-if="!filtered.length" class="empty">
      没有匹配的服务商，试试其他关键词。
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>服务商</th>
            <th>API 地址</th>
            <th>密钥</th>
            <th>状态</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id">
            <td>
              <div class="cell-identity">
                <span class="row-icon"><AdminIcon name="connection" :size="17" /></span><strong>{{ p.name }}</strong>
              </div>
            </td>
            <td class="mono" :title="p.baseUrl">
              {{ p.baseUrl }}
            </td>
            <td>
              <span class="key-mark">••••••••</span><span class="cell-secondary">{{
                p.hasKey ? "已安全保存" : "未配置密钥"
              }}</span>
            </td>
            <td>
              <span class="badge" :class="{ disabled: !p.enabled }">{{
                p.enabled ? "已启用" : "已停用"
              }}</span>
            </td>
            <td class="actions">
              <button :disabled="busy" @click="edit(p)">编辑</button><button
                class="danger-link"
                :disabled="busy"
                @click="
                  removing = p;
                  dialogError = '';
                "
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p class="footnote">
    <AdminIcon
      name="lock"
      :size="14"
    />密钥加密保存且不回显。停用或删除前，请先调整正在使用的模型。
  </p>
  <AdminDialog
    :open="visible"
    :title="editing ? '编辑服务商' : '添加服务商'"
    description="连接信息独立保存，可供多个模型使用。"
    :busy="busy"
    @close="closeEditor"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      id="provider-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <label>服务商名称<input
          v-model="form.name"
          maxlength="80"
          required
          placeholder="例如：OpenAI"
        ></label><label>API 地址<input
          v-model="form.baseUrl"
          type="url"
          maxlength="500"
          required
          placeholder="https://api.openai.com/v1"
        ><small>填写基础地址，通常以 /v1 结尾，不要添加 /models。</small></label><label>API Key<input
          v-model="form.apiKey"
          type="password"
          autocomplete="new-password"
          :required="!editing"
          maxlength="4096"
          :placeholder="
            editing
              ? '留空保留原密钥；修改地址时须重新填写'
              : '输入服务商密钥'
          "
        ><small>只提交到后端加密保存，不会回显到浏览器。</small></label><label class="check"><input v-model="form.enabled" type="checkbox">启用此服务商</label>
      </fieldset>
    </form>
    <template #footer>
      <button :disabled="busy" @click="closeEditor">取消</button><button
        form="provider-form"
        type="submit"
        class="primary"
        :disabled="busy"
      >
        {{ busy ? "正在保存…" : "保存服务商" }}
      </button>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="!!removing"
    title="删除服务商？"
    :description="`将删除「${removing?.name || ''}」。关联模型需先删除，此操作无法撤销。`"
    :busy="busy"
    compact
    @close="removing = null"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <button :disabled="busy" @click="removing = null">取消</button><button
        class="danger"
        :disabled="busy"
        @click="remove"
      >
        {{ busy ? "正在删除…" : "确认删除" }}
      </button>
    </template>
  </AdminDialog>
</template>
