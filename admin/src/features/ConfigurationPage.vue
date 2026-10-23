<script setup lang="ts">
import type {
  AIModelConfig,
  AISettings,
  ConfigurationHistory,
  ConfigurationItem,
  ConfigurationValue,
  ConfigurationView,
} from '@t-box/shared'
import { computed, onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminSelect from '../components/AdminSelect.vue'
import AdminTextarea from '../components/AdminTextarea.vue'
import { errorMessage, request, save } from '../core/api'

const view = ref<ConfigurationView>()
const error = ref('')
const dialogError = ref('')
const busy = ref(false)
const query = ref('')
const selected = ref<ConfigurationItem>()
const value = ref<ConfigurationValue>('')
const note = ref('')
const history = ref<ConfigurationHistory[]>([])
const historyOpen = ref(false)
const memoryModels = ref<AIModelConfig[]>([])
const memoryModelOptions = computed(() => [{ value: 'pool', label: '普通会话模型池（自动分配）' }, ...memoryModels.value.map((model) => ({ value: model.id, label: `${model.name} · ${model.providerName}` }))])
const textValue = computed({
  get: () => String(value.value),
  set: (v: string) => {
    value.value = v
  },
})
const numberValue = computed({
  get: () => Number(value.value),
  set: (v: number) => {
    value.value = v
  },
})
const booleanValue = computed({
  get: () => Boolean(value.value),
  set: (v: boolean) => {
    value.value = v
  },
})
const groups = computed(() => [
  ...new Set(view.value?.items.filter(matches).map((i) => i.group)),
])
function matches(item: ConfigurationItem) {
  return `${item.group} ${item.title} ${item.key} ${item.description}`
    .toLowerCase()
    .includes(query.value.toLowerCase())
}
function items(group: string) {
  return view.value?.items.filter((i) => i.group === group && matches(i)) || []
}
async function load() {
  busy.value = true
  error.value = ''
  try {
    view.value = await request<ConfigurationView>('/configuration')
    const [models, settings] = await Promise.all([request<AIModelConfig[]>('/models'), request<AISettings>('/settings')])
    const pool = settings.modelIds ?? (settings.modelId ? [settings.modelId] : [])
    memoryModels.value = models.filter((model) => model.enabled && model.purpose === 'conversation' && pool.includes(model.id))
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
function edit(item: ConfigurationItem) {
  selected.value = item
  value.value = item.value
  note.value = ''
  dialogError.value = ''
  historyOpen.value = false
}
async function submit(restoreRevision?: number) {
  if (!selected.value || !view.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    view.value = await save<ConfigurationView>(
      `/configuration/${encodeURIComponent(selected.value.key)}`,
      {
        revision: view.value.revision,
        ...(restoreRevision === undefined
          ? { value: value.value }
          : { restoreRevision }),
        note: note.value,
      },
      'PATCH',
    )
    selected.value = undefined
    historyOpen.value = false
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function showHistory(item: ConfigurationItem) {
  edit(item)
  busy.value = true
  try {
    history.value = await request<ConfigurationHistory[]>(
      `/configuration/${encodeURIComponent(item.key)}/history`,
    )
    historyOpen.value = true
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
      <p class="eyebrow">CONFIGURATION</p>
      <h1>配置中心</h1>
      <p>平台 AI 配置统一入库，Redis 按版本缓存。</p>
    </div>
    <AdminButton :disabled="busy" @click="load">刷新</AdminButton>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <section class="panel configuration-intro">
    <div>
      <span class="badge">版本 {{ view?.revision || "—" }}</span>
      <p>
        Prompt
        与执行策略对新任务生效。进行中及继续任务使用已保存的快照；修改不会重跑已完成的工具。
      </p>
      <p class="muted">
        服务商、模型、阶段 Prompt、支付及充值沿用各自专用管理页。应用的
        Agent、Skill、工具定义及业务设置由应用自身维护。
      </p>
    </div>
    <AdminInput
      v-model="query"
      type="search"
      aria-label="搜索配置"
      placeholder="搜索配置名称或键名"
    />
  </section>
  <section
    v-for="group in groups"
    :key="group"
    class="panel configuration-group"
  >
    <h2>{{ group }}</h2>
    <div
      v-for="item in items(group)"
      :key="item.key"
      class="configuration-row"
    >
      <div class="configuration-copy">
        <h3>{{ item.title }}</h3>
        <code>{{ item.key }}</code>
        <p>{{ item.description }}</p>
        <pre>{{ item.value }}</pre>
        <small>{{
          item.effect === "new_task" ? "新任务生效" : "下一次请求生效"
        }}</small>
      </div>
      <div class="configuration-actions">
        <AdminButton :disabled="busy" @click="edit(item)">编辑</AdminButton><AdminButton :disabled="busy" @click="showHistory(item)">历史</AdminButton>
      </div>
    </div>
  </section>
  <p v-if="view && !groups.length" class="empty">没有匹配的配置项</p>
  <AdminDialog
    :open="!!selected"
    :busy="busy"
    :title="historyOpen ? '配置历史' : selected?.title || '编辑配置'"
    @close="
      selected = undefined;
      historyOpen = false;
    "
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template v-if="selected">
      <div v-if="historyOpen" class="configuration-history">
        <article v-for="entry in history" :key="entry.revision">
          <strong>{{
            entry.revision === 0 ? "平台默认值" : `版本 ${entry.revision}`
          }}</strong><small>{{ new Date(entry.createdAt).toLocaleString() }}</small>
          <pre>{{ entry.value }}</pre>
          <p>{{ entry.note }}</p>
          <AdminButton :disabled="busy" @click="submit(entry.revision)">
            恢复为此值并发布新版本
          </AdminButton>
        </article>
      </div>
      <form
        v-else
        id="configuration-form"
        @submit.prevent="submit()"
      >
        <fieldset :disabled="busy">
          <p class="muted">
            {{ selected.description }}
          </p>
          <label v-if="selected.key === 'ai.memory.modelId'">提取模型<AdminSelect
            v-model="textValue"
            label="提取模型"
            :options="memoryModelOptions"
          /></label><label v-else-if="selected.type === 'text'">内容<AdminTextarea
            v-model="textValue"
            rows="12"
            :maxlength="selected.maxLength"
            required
          /></label><label v-else-if="selected.type === 'number'">数值<AdminInput
            v-model.number="numberValue"
            type="number"
            :min="selected.min"
            :max="selected.max"
            :step="selected.step || 1"
            required
          /></label><label v-else-if="selected.type === 'select'">选项<AdminSelect
            v-model="textValue"
            :label="selected.title"
            :options="
              (selected.options || []).map((v) => ({ value: v, label: v }))
            "
          /></label><label
            v-else
            class="check"
          ><AdminCheckbox v-model="booleanValue" />启用</label><label>变更说明<AdminInput
            v-model="note"
            maxlength="500"
            placeholder="可选，用于审计"
          /></label>
          <p class="muted">默认值：{{ selected.defaultValue }}
          </p>
        </fieldset>
      </form>
    </template>
    <template #footer>
      <AdminButton
        :disabled="busy"
        @click="
          selected = undefined;
          historyOpen = false;
        "
      > 关闭</AdminButton><template v-if="selected && !historyOpen">
        <AdminButton :disabled="busy" @click="value = selected.defaultValue"> 填入默认值</AdminButton><AdminButton
          class="primary"
          form="configuration-form"
          type="submit"
          :disabled="busy"
        >
          发布新版本
        </AdminButton>
      </template>
    </template>
  </AdminDialog>
</template>

<style scoped>
.configuration-intro {
  padding: 20px;
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 20px;
}
.configuration-intro p {
  line-height: 1.8;
}
.configuration-intro input {
  min-width: 230px;
}
.configuration-group {
  padding: 20px;
  margin-bottom: 20px;
}
.configuration-group h2 {
  font-size: 16px;
  margin: 0 0 12px;
}
.configuration-row {
  display: flex;
  gap: 18px;
  justify-content: space-between;
  padding: 18px 0;
  border-top: 1px solid #edf1ef;
}
.configuration-copy {
  min-width: 0;
  flex: 1;
}
.configuration-copy h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.configuration-copy code,
.configuration-copy small {
  font-size: 11px;
  color: #7c8e87;
}
.configuration-copy p {
  font-size: 12px;
  color: #60756a;
  line-height: 1.8;
}
.configuration-copy pre,
.configuration-history pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 12px;
  line-height: 1.8;
  max-height: 110px;
  overflow: auto;
  background: #f7f9f8;
  padding: 12px;
  border-radius: 8px;
}
.configuration-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.configuration-history article {
  padding: 14px 0;
  border-bottom: 1px solid #edf1ef;
}
.configuration-history small {
  display: block;
  margin-top: 6px;
  color: #7c8e87;
}
@media (max-width: 700px) {
  .configuration-intro {
    display: block;
  }
  .configuration-intro input {
    width: 100%;
  }
  .configuration-row {
    display: block;
  }
  .configuration-actions {
    margin-top: 12px;
  }
}
</style>
