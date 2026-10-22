<script setup lang="ts">
import type { AiMemory, MemoryKind, MemoryView } from '@t-box/shared'
import { AppIcon, Modal } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { backFromApplication } from '../../core/navigation'
import { request } from '../../core/network'
import { identity } from '../../core/session'

const data = ref<MemoryView>()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const query = ref('')
const tab = ref<'active' | 'candidate'>('active')
const editing = ref<AiMemory | 'new' | null>(null)
const removing = ref<AiMemory | 'all' | null>(null)
const label = ref('')
const content = ref('')
const kind = ref<MemoryKind>('preference')
const ttlDays = ref<number | null>(null)
let originalTtl: number | null = null
const formError = ref('')
const labels: Record<MemoryKind, string> = {
  preference: '使用偏好',
  fact: '个人信息',
  goal: '阶段目标',
}
const items = computed(
  () =>
    data.value?.items.filter(
      (item) =>
        item.status === tab.value &&
        `${item.label} ${item.content}`.includes(query.value.trim()),
    ) ?? [],
)
const pending = computed(
  () =>
    data.value?.items.filter((item) => item.status === 'candidate').length ?? 0,
)
let controller: AbortController | undefined
const userId = identity.user?.id
async function load(quiet = false) {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  if (!quiet) {
    loading.value = true
  }
  error.value = ''
  try {
    const result = await request<{ data: MemoryView }>('/ai/memories/', {
      signal,
    })
    if (!signal.aborted && identity.user?.id === userId) {
      data.value = result.data
    }
  } catch (cause) {
    if (!signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '读取失败，请重试'
    }
  } finally {
    if (!signal.aborted) {
      loading.value = false
    }
  }
}
async function changeSetting(field: 'enabled' | 'autoExtract', value: boolean) {
  if (!data.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    data.value = (
      await request<{ data: MemoryView }>('/ai/memories/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ...data.value.settings, [field]: value }),
      })
    ).data
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '设置失败'
    await load(true)
    error.value = message
  } finally {
    busy.value = false
  }
}
function edit(item: AiMemory | 'new') {
  editing.value = item
  label.value = item === 'new' ? '' : item.label
  content.value = item === 'new' ? '' : item.content
  kind.value = item === 'new' ? 'preference' : item.kind
  ttlDays.value =
    item === 'new' || !item.expiresAt
      ? null
      : Math.max(
          1,
          Math.ceil((Date.parse(item.expiresAt) - Date.now()) / 86400000),
        )
  originalTtl = ttlDays.value
  formError.value = ''
}
async function save() {
  if (!editing.value || busy.value) {
    return
  }
  busy.value = true
  formError.value = ''
  const original = editing.value
  try {
    await request(`/ai/memories/${original === 'new' ? '' : original.id}`, {
      method: original === 'new' ? 'POST' : 'PATCH',
      body: JSON.stringify({
        label: label.value,
        content: content.value,
        kind: kind.value,
        ...(original === 'new' || ttlDays.value !== originalTtl
          ? { ttlDays: ttlDays.value || null }
          : {}),
        ...(original === 'new' ? {} : { version: original.version }),
      }),
    })
    editing.value = null
    notice.value = '记忆已保存'
    await load(true)
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    busy.value = false
  }
}
async function accept(item: AiMemory) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await request(`/ai/memories/${item.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ version: item.version }),
    })
    notice.value = '已确认，后续对话可以使用'
    await load(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '确认失败'
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!removing.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await request(
      `/ai/memories/${removing.value === 'all' ? 'all' : removing.value.id}`,
      { method: 'DELETE' },
    )
    removing.value = null
    notice.value = '记忆已删除'
    await load(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  } finally {
    busy.value = false
  }
}
onMounted(() => load())
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="memory-page">
    <ApplicationHeader
      title="AI 记忆"
      back-label="AI"
      @back="backFromApplication"
    ><template #actions><button
      class="icon-button"
      aria-label="刷新记忆"
      :disabled="loading || busy"
      @click="load()"
    >
      <AppIcon name="refresh" :size="18" /></button></template></ApplicationHeader>
    <div class="memory-body">
      <div class="memory-intro">
        <div class="memory-mark"><AppIcon name="history" :size="23" /></div>
        <div>
          <h2>让下一次对话更懂你</h2>
          <p>只使用你确认的信息，随时修改或忘记。</p>
        </div>
      </div>
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >{{ error }}</p>
      <p
        v-if="notice"
        class="memory-notice"
        role="status"
      >{{ notice }}</p>
      <p
        v-if="loading"
        class="memory-empty"
        role="status"
      >正在读取记忆…</p>
      <template v-if="data">
        <p v-if="!data.available" class="memory-helper">
          记忆服务暂未开放，你仍可以管理已保存的信息。
        </p>
        <div class="memory-settings">
          <label><span>使用记忆<small>在之后的对话中参考已确认的信息</small></span><input
            type="checkbox"
            :checked="data.settings.enabled"
            :disabled="busy"
            @change="
              changeSetting(
                'enabled',
                ($event.target as HTMLInputElement).checked,
              )
            "
          ></label>
          <label><span>自动整理建议<small>后台提取偏好与阶段目标，确认后才会生效</small></span><input
            type="checkbox"
            :checked="data.settings.autoExtract"
            :disabled="busy || !data.settings.enabled || !data.available"
            @change="
              changeSetting(
                'autoExtract',
                ($event.target as HTMLInputElement).checked,
              )
            "
          ></label>
        </div>
        <div class="memory-toolbar">
          <div
            class="memory-tabs"
            role="tablist"
            aria-label="记忆状态"
          >
            <button
              role="tab"
              :aria-selected="tab === 'active'"
              @click="tab = 'active'"
            >
              已记住</button><button
              role="tab"
              :aria-selected="tab === 'candidate'"
              @click="tab = 'candidate'"
            >
              待确认<span v-if="pending">{{ pending }}</span>
            </button>
          </div>
          <button
            class="memory-add"
            :disabled="busy || !data.settings.enabled"
            @click="edit('new')"
          >
            <AppIcon name="plus" :size="15" />添加
          </button>
        </div>
        <label class="memory-search"><AppIcon name="search" :size="16" /><input
          v-model="query"
          placeholder="搜索记忆"
          aria-label="搜索记忆"
        ></label>
        <p v-if="data.extraction.queued" class="memory-helper">
          {{ data.extraction.queued }} 条消息等待后台整理，稍后刷新查看建议。
        </p>
        <p v-if="data.extraction.failed" class="memory-helper">
          {{ data.extraction.failed }}
          项整理未完成，不影响正常对话。{{ data.extraction.lastError }}
        </p>
        <div v-if="!items.length" class="memory-empty">
          <AppIcon
            :name="tab === 'candidate' ? 'check' : 'history'"
            :size="25"
          /><strong>{{
            query
              ? '没有匹配的记忆'
              : tab === 'candidate'
                ? '暂时没有待确认的建议'
                : '还没有记住的信息'
          }}</strong>
          <p>
            {{
              tab === 'candidate'
                ? '开启自动整理后，有用的信息会在这里等你确认。'
                : '添加常用偏好，或在对话中说「帮我记住」。'
            }}
          </p>
        </div>
        <ul v-else class="memory-list">
          <li v-for="item in items" :key="item.id">
            <div class="memory-item-heading">
              <span class="memory-kind">{{ labels[item.kind] }}</span><span
                v-if="item.expiresAt"
                class="memory-expiry"
              >至
                {{ new Date(item.expiresAt).toLocaleDateString('zh-CN') }}</span>
              <div class="memory-item-actions">
                <button
                  v-if="item.status === 'active'"
                  class="icon-button"
                  :aria-label="`编辑${item.label}`"
                  :disabled="busy"
                  @click="edit(item)"
                >
                  <AppIcon name="edit" :size="16" /></button><button
                  class="icon-button"
                  :aria-label="`删除${item.label}`"
                  :disabled="busy"
                  @click="removing = item"
                >
                  <AppIcon name="trash" :size="16" />
                </button>
              </div>
            </div>
            <h2>{{ item.label }}</h2>
            <p class="memory-content">{{ item.content }}</p>
            <details v-if="item.sources.length">
              <summary>来自对话</summary>
              <blockquote
                v-for="source in item.sources"
                :key="source.messageId"
              >
                {{ source.excerpt }}
              </blockquote>
            </details>
            <footer>
              <small>{{
                item.origin === 'manual'
                  ? '你添加的信息'
                  : item.origin === 'extracted'
                    ? '从你的消息提取'
                    : '对话中确认保存'
              }}</small><button
                v-if="item.status === 'candidate'"
                class="memory-accept"
                :disabled="busy || !data.settings.enabled"
                @click="accept(item)"
              >
                <AppIcon name="check" :size="14" />确认记住
              </button>
            </footer>
          </li>
        </ul>
        <div class="memory-bottom">
          <p>
            记忆不包含密码或应用授权。账单、日程和成长记录仍由对应应用管理。
          </p>
          <button
            v-if="data.items.length"
            :disabled="busy"
            @click="removing = 'all'"
          >
            清空全部记忆
          </button>
        </div>
      </template>
    </div>
    <Modal
      :open="!!editing"
      :title="editing === 'new' ? '添加记忆' : '修改记忆'"
      :busy="busy"
      @close="editing = null"
    ><form class="memory-form" @submit.prevent="save">
      <label>名称<input
        v-model="label"
        maxlength="80"
        placeholder="例如：回答习惯"
        required
      ></label><label>记住的信息<textarea
        v-model="content"
        maxlength="800"
        rows="4"
        placeholder="例如：我喜欢简洁回答，需要时再展开说明。"
        required
      />
      </label>
      <fieldset>
        <legend>信息类型</legend>
        <div class="memory-kind-options">
          <button
            v-for="(text, key) in labels"
            :key="key"
            type="button"
            :aria-pressed="kind === key"
            @click="kind = key"
          >
            {{ text }}
          </button>
        </div>
      </fieldset>
      <label>有效天数<small>留空表示长期保留</small><input
        v-model.number="ttlDays"
        type="number"
        min="1"
        max="3650"
        placeholder="长期"
      ></label>
      <p
        v-if="formError"
        class="form-error"
        role="alert"
      >{{ formError }}</p>
      <div class="memory-form-actions">
        <button
          type="button"
          class="button button-secondary"
          :disabled="busy"
          @click="editing = null"
        >
          取消</button><button class="button button-primary" :disabled="busy">
          {{ busy ? '保存中…' : '保存记忆' }}
        </button>
      </div>
    </form></Modal>
    <Modal
      :open="!!removing"
      :title="removing === 'all' ? '清空全部记忆？' : '忘记这项信息？'"
      :busy="busy"
      @close="removing = null"
    ><p class="memory-delete-copy">
       {{
         removing === 'all'
           ? '已确认和待确认的信息都会删除，旧整理任务不会重新生成它们。'
           : '删除后不再用于新的模型请求。'
       }}原聊天记录和应用数据会保留。
     </p>
      <template #footer><button
        class="button button-secondary"
        :disabled="busy"
        @click="removing = null"
      >
        取消</button><button
        class="button button-primary"
        :disabled="busy"
        @click="remove"
      >
        {{ busy ? '删除中…' : '确认删除' }}
      </button></template></Modal>
  </section>
</template>

<style scoped>
.memory-page {
  width: 100%;
  min-height: 100%;
  background: #f7faf8;
  color: var(--ink);
}
.memory-body {
  max-width: 920px;
  padding: 18px 20px 28px;
  margin: auto;
}
.memory-intro {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 22px;
}
.memory-mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #e6f0e9;
  color: #4f7e69;
}
.memory-intro h2 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 7px;
}
.memory-intro p,
.memory-helper {
  font-size: 12px;
  color: #7e9085;
  margin: 0;
  line-height: 1.7;
}
.memory-settings {
  border: 1px solid #dfe9e2;
  border-radius: 13px;
  background: #fff;
  padding: 0 15px;
}
.memory-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 0;
  font-size: 13px;
  cursor: pointer;
}
.memory-settings label + label {
  border-top: 1px solid #edf2ee;
}
.memory-settings small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #849289;
  line-height: 1.6;
}
.memory-settings input {
  accent-color: #568571;
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
.memory-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 24px 0 13px;
}
.memory-tabs {
  display: flex;
  gap: 17px;
}
.memory-tabs button {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 0;
  padding: 8px 0;
  background: none;
  font-size: 13px;
  color: #8a9990;
  border-bottom: 2px solid transparent;
}
.memory-tabs button[aria-selected='true'] {
  color: #346751;
  border-color: #568571;
}
.memory-tabs span {
  font-size: 10px;
  background: #e4efe7;
  padding: 2px 5px;
  border-radius: 6px;
}
.memory-add,
.memory-accept {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #e9f2ec;
  border: 0;
  border-radius: 8px;
  color: #42755e;
  padding: 8px 10px;
  font-size: 12px;
}
.memory-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e0e9e3;
  border-radius: 9px;
  padding: 0 10px;
  background: white;
  color: #93a197;
}
.memory-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  padding: 10px 0;
  font-size: 12px;
  outline: none;
}
.memory-search:focus-within {
  border-color: #87aa94;
}
.memory-helper {
  margin-top: 12px;
}
.memory-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  list-style: none;
  margin: 16px 0;
}
.memory-list li {
  min-width: 0;
  border: 1px solid #dfe8e2;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
  display: flex;
  flex-direction: column;
}
.memory-item-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.memory-kind {
  font-size: 10px;
  color: #63816c;
  background: #f0f5f1;
  border-radius: 5px;
  padding: 4px 6px;
}
.memory-expiry {
  font-size: 10px;
  color: #99a59c;
}
.memory-item-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}
.memory-item-actions button {
  width: 26px;
  height: 26px;
  color: #91a095;
}
.memory-list h2 {
  font-size: 13px;
  font-weight: 600;
  margin: 12px 0 8px;
}
.memory-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.85;
  margin: 0 0 14px;
  color: #53675c;
}
.memory-list details {
  font-size: 11px;
  color: #8a9a90;
  margin-bottom: 14px;
}
.memory-list summary {
  cursor: pointer;
}
.memory-list blockquote {
  margin: 8px 0;
  padding: 8px;
  border-left: 2px solid #dde9e0;
  background: #f7faf8;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.memory-list footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  border-top: 1px solid #f0f3f0;
  padding-top: 10px;
}
.memory-list footer small {
  font-size: 10px;
  color: #99a59d;
}
.memory-accept {
  font-size: 11px;
  padding: 6px 8px;
}
.memory-empty {
  padding: 38px 12px;
  text-align: center;
  color: #9aa89e;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.memory-empty strong {
  font-size: 13px;
  font-weight: 500;
  color: #73887a;
}
.memory-empty p {
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
  max-width: 260px;
}
.memory-bottom {
  font-size: 11px;
  color: #93a096;
  line-height: 1.9;
  padding: 10px 0;
}
.memory-bottom button {
  border: 0;
  background: none;
  padding: 8px 0;
  color: #a57c6e;
  font-size: 11px;
}
.memory-notice {
  font-size: 12px;
  color: #49765a;
  line-height: 1.7;
}
.memory-form {
  display: grid;
  gap: 16px;
}
.memory-form label {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
.memory-form small {
  font-size: 11px;
  color: #91a096;
}
.memory-form input,
.memory-form textarea {
  width: 100%;
  border: 1px solid #dce6df;
  border-radius: 8px;
  padding: 10px;
  font: inherit;
  box-sizing: border-box;
}
.memory-form input:focus,
.memory-form textarea:focus {
  outline: none;
  border-color: #79a48b;
}
.memory-form textarea {
  resize: vertical;
  line-height: 1.8;
}
.memory-form fieldset {
  border: 0;
  padding: 0;
  margin: 0;
}
.memory-form legend {
  font-size: 12px;
  margin-bottom: 8px;
}
.memory-kind-options {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.memory-kind-options button {
  border: 1px solid #e0e8e2;
  border-radius: 7px;
  background: #fff;
  padding: 8px 10px;
  font-size: 12px;
  color: #87958a;
}
.memory-kind-options button[aria-pressed='true'] {
  border-color: #9bbaa5;
  background: #eef5f0;
  color: #4a7559;
}
.memory-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.memory-delete-copy {
  font-size: 13px;
  line-height: 1.9;
  color: #738278;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible {
  outline: 2px solid #87aa94;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .memory-body {
    padding: 14px 12px 24px;
  }
  .memory-intro {
    margin-bottom: 18px;
  }
  .memory-intro h2 {
    font-size: 15px;
  }
  .memory-list {
    grid-template-columns: 1fr;
  }
  .memory-list li {
    padding: 13px;
  }
  .memory-settings {
    padding: 0 12px;
  }
  .memory-settings label {
    padding: 12px 0;
  }
}
</style>
