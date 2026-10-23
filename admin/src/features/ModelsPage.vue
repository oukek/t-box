<script setup lang="ts">
import type {
  AIModelConfig,
  AIProviderConfig,
  AISettings,
  ImageTier,
  ModelInvocationMode,
  RemoteModel,
} from '@t-box/shared'
import {
  contextInputBudget,
  contextOutputBudget,
  IMAGE_TIERS,
  resolveContextPolicy,
} from '@t-box/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminCheckbox from '../components/AdminCheckbox.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request, save } from '../core/api'

const providers = ref<AIProviderConfig[]>([])
const models = ref<AIModelConfig[]>([])
const options = ref<RemoteModel[]>([])
const selected = ref<string[]>([])
const applied = ref<string[]>([])
const selectedImage = ref<string[]>([])
const appliedImage = ref<string[]>([])
const error = ref('')
const dialogError = ref('')
const notice = ref('')
const busy = ref(false)
const loading = ref(true)
const loadingOptions = ref(false)
const optionError = ref('')
const visible = ref(false)
const runtimeOpen = ref(false)
const editing = ref<string | null>(null)
const query = ref('')
const confirmation = ref<{
  title: string
  description: string
  action: () => Promise<unknown>
  success: string
  danger: boolean
} | null>(null)
const form = reactive({
  providerId: '',
  modelId: '',
  name: '',
  enabled: true,
  purpose: 'conversation' as 'conversation' | 'image',
  imageTiers: ['1k'] as ImageTier[],
  imagePrices: {} as Partial<Record<ImageTier, string>>,
  invocationMode: 'responses' as ModelInvocationMode,
  supportsVision: false,
  supportsReasoning: false,
  costMultiplier: '1',
  inputPrice: '0',
  outputPrice: '0',
  imagePrice: '0',
  contextPolicy: resolveContextPolicy(),
  maxConcurrency: 4,
})
function supportedImageTiers(model: AIModelConfig): ImageTier[] {
  return model.imageTiers ?? ['1k']
}
const contextBudget = computed(() =>
  contextInputBudget(
    form.contextPolicy,
    contextOutputBudget(form.contextPolicy, form.supportsReasoning),
  ),
)
const compactionTrigger = computed(() =>
  Math.floor(contextBudget.value * form.contextPolicy.compactionThreshold),
)
const filteredModels = computed(() =>
  models.value.filter((m) =>
    `${m.name} ${m.modelId} ${m.providerName}`
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
)
const providerOptions = computed(() =>
  providers.value.map((p) => ({
    value: p.id,
    label: p.name,
    disabled: !p.enabled,
    description: p.enabled ? p.baseUrl : '已停用',
  })),
)
const remoteOptions = computed(() => {
  const result = options.value.map((m) => ({
    value: m.id,
    label: m.id,
    description: m.ownedBy,
  }))
  if (
    editing.value &&
    form.modelId &&
    !result.some((m) => m.value === form.modelId)
  ) {
    result.unshift({
      value: form.modelId,
      label: form.modelId,
      description: '已保存的模型',
    })
  }
  return result
})
function poolOptions(purpose: 'conversation' | 'image') {
  return models.value.filter((m) => m.purpose === purpose)
}
function available(model: AIModelConfig) {
  return (
    model.enabled &&
    providers.value.some((p) => p.id === model.providerId && p.enabled)
  )
}
function poolName(ids: string[], fallback: string) {
  return ids.length ? `${ids.length} 个模型参与调度` : fallback
}
function poolSummary(ids: string[]) {
  return ids
    .map((id) => models.value.find((m) => m.id === id)?.name || '模型不可用')
    .join('、')
}
let controller: AbortController | undefined
async function load() {
  loading.value = true
  try {
    const [p, m, s] = await Promise.all([
      request<AIProviderConfig[]>('/providers'),
      request<AIModelConfig[]>('/models'),
      request<AISettings>('/settings'),
    ])
    providers.value = p
    models.value = m
    applied.value = s.modelIds ?? (s.modelId ? [s.modelId] : [])
    appliedImage.value =
      s.imageModelIds ?? (s.imageModelId ? [s.imageModelId] : [])
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
async function loadOptions() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  options.value = []
  optionError.value = ''
  loadingOptions.value = false
  if (!form.providerId || !visible.value) {
    return
  }
  loadingOptions.value = true
  try {
    const result = await request<RemoteModel[]>(
      `/providers/${form.providerId}/models`,
      { signal: current.signal },
    )
    if (!current.signal.aborted) {
      options.value = result
    }
  } catch (e) {
    if (!current.signal.aborted) {
      optionError.value = errorMessage(e)
    }
  } finally {
    if (!current.signal.aborted) {
      loadingOptions.value = false
    }
  }
}
watch(
  () => form.providerId,
  () => {
    form.modelId = ''
    void loadOptions()
  },
  { flush: 'sync' },
)
function edit(model?: AIModelConfig) {
  editing.value = model?.id || null
  visible.value = true
  dialogError.value = ''
  const changed = form.providerId !== (model?.providerId || '')
  form.providerId = model?.providerId || ''
  form.modelId = model?.modelId || ''
  form.name = model?.name || ''
  form.enabled = model?.enabled ?? true
  form.purpose = model?.purpose || 'conversation'
  form.imageTiers = [...(model?.imageTiers ?? ['1k'])]
  form.imagePrices = { ...model?.imagePrices }
  form.invocationMode =
    model?.invocationMode ?? (form.purpose === 'image' ? 'images' : 'responses')
  form.supportsVision = model?.supportsVision ?? false
  form.supportsReasoning = model?.supportsReasoning ?? false
  form.costMultiplier = model?.costMultiplier ?? '1'
  form.inputPrice = model?.inputPrice ?? '0'
  form.outputPrice = model?.outputPrice ?? '0'
  form.imagePrice = model?.imagePrice ?? '0'
  form.contextPolicy = resolveContextPolicy(model?.contextPolicy)
  form.maxConcurrency = model?.maxConcurrency ?? 4
  if (!changed) {
    void loadOptions()
  }
}
watch(
  () => [form.purpose, form.invocationMode],
  () => {
    if (form.purpose === 'image') {
      form.invocationMode = 'images'
    } else if (form.invocationMode === 'images') {
      form.invocationMode = 'responses'
    }
    if (form.invocationMode === 'chat_completions') {
      form.contextPolicy.tokenCounting = false
      if (form.contextPolicy.compactionMode === 'native') {
        form.contextPolicy.compactionMode = 'summary'
      }
    }
  },
)
function invocationLabel(mode?: ModelInvocationMode) {
  return mode === 'images'
    ? 'Images API'
    : mode === 'chat_completions'
      ? 'Chat Completions'
      : 'Responses'
}
function closeEditor() {
  if (busy.value) {
    return
  }
  visible.value = false
  controller?.abort()
}
function configure() {
  selected.value = [...applied.value]
  selectedImage.value = [...appliedImage.value]
  dialogError.value = ''
  runtimeOpen.value = true
}
async function action(work: () => Promise<unknown>, message: string) {
  busy.value = true
  error.value = ''
  dialogError.value = ''
  notice.value = ''
  try {
    await work()
    notice.value = message
    await load()
    return true
  } catch (e) {
    if (visible.value || runtimeOpen.value || confirmation.value) {
      dialogError.value = errorMessage(e)
    } else {
      error.value = errorMessage(e)
    }
    return false
  } finally {
    busy.value = false
  }
}
async function submit() {
  if (
    await action(
      () =>
        save(
          editing.value ? `/models/${editing.value}` : '/models',
          { ...form, imagePrices: Object.fromEntries(form.imageTiers.map((tier) => [tier, form.imagePrices[tier] ?? ''])) },
          editing.value ? 'PATCH' : 'POST',
        ),
      '模型配置已保存',
    )
  ) {
    closeEditor()
  }
}
async function select() {
  if (
    await action(
      () =>
        save(
          '/settings',
          {
            modelIds: selected.value,
            imageModelIds: selectedImage.value,
          },
          'PATCH',
        ),
      '使用配置已更新，下一轮对话生效',
    )
  ) {
    runtimeOpen.value = false
  }
}
function remove(model: AIModelConfig) {
  dialogError.value = ''
  confirmation.value = {
    title: `删除「${model.name}」？`,
    description: '删除后无法继续选择此模型。正在使用的模型需要先调整使用配置。',
    action: () => request(`/models/${model.id}`, { method: 'DELETE' }),
    success: '模型配置已删除',
    danger: true,
  }
}
function test(model: AIModelConfig) {
  dialogError.value = ''
  confirmation.value = {
    title: '测试模型连接',
    description: `将向「${model.name}」发送一次小型测试请求，验证流式响应和工具调用，可能产生少量模型费用。`,
    action: () => save(`/models/${model.id}/test`, {}),
    success: '流式响应与工具调用测试通过',
    danger: false,
  }
}
async function confirmAction() {
  const task = confirmation.value
  if (task && (await action(task.action, task.success))) {
    confirmation.value = null
  }
}
onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">能力配置 / 模型</p>
      <h1>模型管理</h1>
      <p>同一用途可配置多个模型，按负载自动分配新任务。</p>
    </div>
    <AdminButton
      class="primary"
      :disabled="busy || loading"
      @click="edit()"
    >
      <AdminIcon name="plus" :size="16" />添加模型
    </AdminButton>
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
  <div class="runtime-grid">
    <section class="runtime-card">
      <div class="runtime-card-top">
        <span class="capability-icon"><AdminIcon name="chat" :size="21" /></span><span class="runtime-label">普通会话</span><AdminButton :disabled="busy || loading" @click="configure">
          配置<AdminIcon name="arrow" :size="14" />
        </AdminButton>
      </div>
      <h2>
        {{ loading ? '正在读取…' : poolName(applied, '未启用会话模型') }}
      </h2>
      <p class="runtime-model">
        {{ poolSummary(applied) || '配置并保存后启用 AI 对话' }}
      </p>
      <div class="runtime-caption">
        <span
          class="status-dot"
          :class="{ neutral: !applied.length }"
        />用于日常对话与应用工具调用
      </div>
    </section>
    <section class="runtime-card">
      <div class="runtime-card-top">
        <span class="capability-icon image"><AdminIcon name="image" :size="21" /></span><span class="runtime-label">图片生成与编辑</span><AdminButton :disabled="busy || loading" @click="configure">
          配置<AdminIcon name="arrow" :size="14" />
        </AdminButton>
      </div>
      <h2>{{ loading ? '正在读取…' : poolName(appliedImage, '尚未启用') }}</h2>
      <p class="runtime-model">
        {{ poolSummary(appliedImage) || '配置图片模型后，可通过对话调用' }}
      </p>
      <div class="runtime-caption">
        <span
          class="status-dot"
          :class="{ neutral: !appliedImage.length }"
        />按需调用，上传图片不会触发生成
      </div>
    </section>
  </div>
  <section class="panel">
    <div class="panel-heading">
      <h2>
        模型目录<span class="count">{{ models.length }}</span>
      </h2>
      <div class="search-field">
        <AdminIcon name="search" :size="16" /><AdminInput
          v-model="query"
          aria-label="搜索模型"
          placeholder="搜索名称、标识、服务商"
        />
      </div>
    </div>
    <div v-if="loading" class="empty">正在读取模型…</div>
    <div v-else-if="!models.length" class="empty">
      <span class="empty-symbol"><AdminIcon name="model" :size="26" /></span>
      <h3>添加第一个模型</h3>
      <p>先配置服务商，再选择它提供的模型。</p>
      <AdminButton @click="edit()">添加模型</AdminButton>
    </div>
    <div v-else-if="!filteredModels.length" class="empty">
      没有匹配的模型，试试其他关键词。
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>模型</th>
            <th>服务商</th>
            <th>用途 / 调用方式</th>
            <th>采购报价（元）</th>
            <th>并发 / 状态</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in filteredModels" :key="m.id">
            <td>
              <strong>{{ m.name }}</strong><span class="cell-secondary mono" :title="m.modelId">{{
                m.modelId
              }}</span>
            </td>
            <td>{{ m.providerName }}</td>
            <td>
              <span class="purpose-label"><AdminIcon
                :name="m.purpose === 'image' ? 'image' : 'chat'"
                :size="15"
              />{{
                m.purpose === 'image' ? `图片生成 / 编辑 · ${(m.imageTiers ?? ['1k']).map((tier) => tier.toUpperCase()).join(' / ')}` : '普通会话'
              }}</span><span class="cell-secondary">{{
                invocationLabel(m.invocationMode)
              }}</span><span
                v-if="m.purpose === 'conversation' && m.supportsVision"
                class="cell-secondary"
              >支持图片输入</span>
            </td>
            <td>
              <template v-if="m.purpose === 'conversation'">
                <span>输入 {{ m.inputPrice }}</span><span class="cell-secondary">输出 {{ m.outputPrice }} / 百万 token</span> </template><template v-else><span
                v-for="tier in supportedImageTiers(m)"
                :key="tier"
                class="cell-secondary"
              >{{ tier.toUpperCase() }} · {{ m.imagePrices?.[tier] ?? m.imagePrice }} / 张</span></template>
            </td>
            <td>
              <span class="cell-secondary">最多 {{ m.maxConcurrency ?? 4 }} 个请求</span>
              <span class="badge" :class="{ disabled: !m.enabled }">{{
                m.enabled ? '已启用' : '已停用'
              }}</span><span
                v-if="applied.includes(m.id) || appliedImage.includes(m.id)"
                class="cell-secondary"
              >参与调度</span>
            </td>
            <td class="actions">
              <AdminButton :disabled="busy" @click="edit(m)">编辑</AdminButton><AdminButton
                v-if="m.purpose === 'conversation'"
                :disabled="busy || !m.enabled"
                @click="test(m)"
              >
                测试</AdminButton><AdminButton
                :disabled="busy"
                class="danger-link"
                @click="remove(m)"
              >
                删除
              </AdminButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p class="footnote">
    模型列表不代表接口兼容。普通会话需支持 所选的 Responses 或 Chat Completions
    接口、流式响应与工具调用；图片模型需支持 Images API 生成和编辑接口。
  </p>
  <AdminDialog
    :open="visible"
    :title="editing ? '编辑模型' : '添加模型'"
    description="选择服务商后加载模型列表，设置用途与显示名称。"
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
      id="model-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label class="wide">服务商<AdminSelect
            v-model="form.providerId"
            label="服务商"
            :options="providerOptions"
            placeholder="选择服务商"
            searchable
            required
            :disabled="busy"
          /></label>
          <label class="wide">模型<AdminSelect
            v-model="form.modelId"
            label="模型"
            :options="remoteOptions"
            :placeholder="loadingOptions ? '正在加载模型…' : '选择远程模型'"
            :empty-text="
              form.providerId ? '服务商未返回可选模型' : '请先选择服务商'
            "
            searchable
            required
            :disabled="busy || loadingOptions || !form.providerId"
          /></label>
          <p
            v-if="optionError"
            class="alert wide"
            role="alert"
          >
            {{ optionError
            }}<AdminButton
              type="button"
              :disabled="busy || loadingOptions"
              @click="loadOptions"
            >
              重新加载
            </AdminButton>
          </p>
          <label>用途<AdminSelect
            v-model="form.purpose"
            label="用途"
            :options="[
              { value: 'conversation', label: '普通会话' },
              { value: 'image', label: '图片生成 / 编辑' },
            ]"
            :disabled="busy"
          /></label><label>显示名称<AdminInput
            v-model="form.name"
            required
            maxlength="80"
            placeholder="例如：日常助手"
          /></label>
          <fieldset v-if="form.purpose === 'image'" class="wide image-tiers-field">
            <legend>支持的图片分辨率（可多选）</legend>
            <div class="image-tier-options">
              <label
                v-for="(tier, index) in IMAGE_TIERS"
                :key="tier"
                class="image-tier-option"
                :class="{ selected: form.imageTiers.includes(tier) }"
              >
                <AdminCheckbox
                  v-model="form.imageTiers"
                  :value="tier"
                  :required="index === 0 && !form.imageTiers.length"
                />{{ tier.toUpperCase() }}
              </label>
            </div>
            <small>至少选择一项，按服务商实际能力勾选。只勾选 2K、4K 的模型不会用于默认 1K 请求。</small>
          </fieldset>
          <label class="wide">模型并发上限<AdminInput
            v-model.number="form.maxConcurrency"
            type="number"
            min="1"
            max="128"
            required
          /><small>1–128；同时受服务商总并发上限约束，超限请求会排队。</small></label>
          <label class="wide">调用方式<AdminSelect
            v-model="form.invocationMode"
            label="调用方式"
            :options="
              form.purpose === 'image'
                ? [{ value: 'images', label: 'Images API' }]
                : [
                  {
                    value: 'responses',
                    label: 'Responses',
                    description: '/responses，支持原生压缩与精确输入计数',
                  },
                  {
                    value: 'chat_completions',
                    label: 'Chat Completions',
                    description:
                      '/chat/completions，适用于 OpenAI 兼容会话服务商',
                  },
                ]
            "
            :disabled="busy || form.purpose === 'image'"
          /><small>{{
            form.purpose === 'image'
              ? '使用独立图片模型，调用生成和编辑接口。'
              : '按服务商支持的接口选择。分析、工具循环、回复、摘要及标题统一使用该调用方式。'
          }}</small></label>
          <template v-if="form.purpose === 'conversation'">
            <label>上游输入报价（元 / 百万 token）<AdminInput
              v-model="form.inputPrice"
              inputmode="decimal"
              required
              maxlength="14"
              pattern="[0-9]+([.][0-9]{1,6})?"
            /></label>
            <label>上游输出报价（元 / 百万 token）<AdminInput
              v-model="form.outputPrice"
              inputmode="decimal"
              required
              maxlength="14"
              pattern="[0-9]+([.][0-9]{1,6})?"
            /></label>
          </template>
          <label
            v-else
            class="wide"
          >上游图片报价（元 / 张）<AdminInput
            v-model="form.imagePrice"
            inputmode="decimal"
            required
            maxlength="14"
            pattern="[0-9]+([.][0-9]{1,6})?"
          /><small>统一采购报价；下面未单独填写的档位沿用此价格。生成与编辑每次一张，用于平台采购成本统计。</small></label>
          <template v-if="form.purpose === 'image'">
            <label v-for="tier in IMAGE_TIERS.filter((tier) => form.imageTiers.includes(tier))" :key="tier">{{ tier.toUpperCase() }} 采购报价（元 / 张，可选）<AdminInput
              v-model="form.imagePrices[tier]"
              inputmode="decimal"
              maxlength="14"
              pattern="[0-9]+([.][0-9]{1,6})?"
              :placeholder="`沿用统一报价 ${form.imagePrice}`"
            /></label>
          </template>
          <label>上游采购倍率<AdminInput
            v-model="form.costMultiplier"
            inputmode="decimal"
            required
            placeholder="1 表示原价，0.8 表示八折"
          /></label>
          <p class="footnote">
            以上为供应商采购成本；用户额度费率在“资源包与费率”配置。
          </p>
          <p class="wide muted">
            0 表示免费，支持 6 位小数。按实际用量结算，标题生成不扣用户余额。
          </p>
          <template v-if="form.purpose === 'conversation'">
            <label class="wide">输入上下文预算 / token<AdminInput
              v-model.number="form.contextPolicy.maxInputTokens"
              type="number"
              min="8192"
              max="2000000"
              step="1"
              required
            /><small>设为服务商实际支持的输入预算，需预留输出空间。</small></label>
            <label>总上下文窗口 / token<AdminInput
              v-model.number="form.contextPolicy.contextWindowTokens"
              type="number"
              min="0"
              max="2000000"
              required
            /><small>0 表示未知，请按服务商文档填写。自动预留输出和 1024 token
              安全余量。</small></label>
            <label>输出预算 / token<AdminInput
              v-model.number="form.contextPolicy.maxOutputTokens"
              type="number"
              min="0"
              max="262144"
              required
            /><small>0 为自动：推理模型 32768，普通模型
              8192。包含隐藏推理及正文。</small></label>
            <label class="wide">上下文压缩方式<AdminSelect
              v-model="form.contextPolicy.compactionMode"
              label="上下文压缩方式"
              :options="[
                {
                  value: 'summary',
                  label: '事实摘要（推荐）',
                  description: '普通会话接口即可，保留最近原文与完整调用对',
                },
                {
                  value: 'native',
                  disabled: form.invocationMode !== 'responses',
                  label: '服务商原生压缩',
                  description: '仅适用于支持 /responses/compact 的服务商',
                },
                {
                  value: 'off',
                  label: '关闭压缩',
                  description: '超过有效输入预算时暂停并提示',
                },
              ]"
            /><small>每轮模型调用前检查，包括工具执行过程中。摘要/原生压缩按实际
              token 计费，原始会话与操作记录保留。</small></label>
            <p class="wide muted">
              当前有效输入预算 {{ contextBudget.toLocaleString() }} token<span
                v-if="form.contextPolicy.compactionMode !== 'off'"
              >，达到 {{ compactionTrigger.toLocaleString() }} token
                触发压缩</span>。此数值来自当前配置，并非模型容量自动检测结果。
            </p>
            <template v-if="form.contextPolicy.compactionMode !== 'off'">
              <label>压缩触发比例<AdminInput
                v-model.number="form.contextPolicy.compactionThreshold"
                type="number"
                min="0.5"
                max="0.9"
                step="0.05"
                required
              /><small>默认 0.75，即有效输入预算的 75%。</small></label>
              <label>优先保留最近轮数<AdminInput
                v-model.number="form.contextPolicy.keepRecentTurns"
                type="number"
                min="1"
                max="12"
                required
              /><small>默认 4 轮；过大时缩小窗口，始终保留最新请求。</small></label>
              <label
                v-if="form.contextPolicy.compactionMode === 'summary'"
                class="wide"
              >摘要目标长度 / token<AdminInput
                v-model.number="form.contextPolicy.summaryTargetTokens"
                type="number"
                min="512"
                max="8192"
                required
              /><small>默认
                2048。分段整理，保留事实、约束、资源引用及真实操作状态。</small></label>
            </template>
            <label class="check wide"><AdminCheckbox
              v-model="form.contextPolicy.tokenCounting"
              :disabled="form.invocationMode !== 'responses'"
            />使用服务商精确输入计数<small>Chat Completions 使用本地分词估算。Responses 仅在支持
              /responses/input_tokens
              时开启。否则采用本地分词估算并预留安全余量；不同模型分词可能有差异，图片单独预留。实际扣费以服务商
              usage 为准。</small></label>
            <label class="check wide"><AdminCheckbox
              v-model="form.contextPolicy.promptCacheKey"
            />发送稳定缓存键<small>仅在服务商支持 prompt_cache_key 时开启。缓存命中以实际 usage
              为准。</small></label>
          </template>
          <label
            v-if="form.purpose === 'conversation'"
            class="check wide"
          ><AdminCheckbox
            v-model="form.supportsVision"
          />支持图片输入（看图）<small>需确认服务商支持此能力</small></label><label
            v-if="form.purpose === 'conversation'"
            class="check wide"
          ><AdminCheckbox
            v-model="form.supportsReasoning"
          />推理模型<small>用于自动输出预算；仅在服务商和模型支持推理能力时启用</small></label><label class="check wide"><AdminCheckbox v-model="form.enabled" />启用此模型</label>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="closeEditor">取消</AdminButton><AdminButton
        form="model-form"
        type="submit"
        class="primary"
        :disabled="busy || loadingOptions || !form.providerId || !form.modelId"
      >
        {{ busy ? '正在保存…' : '保存模型' }}
      </AdminButton>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="runtimeOpen"
    title="配置模型池"
    description="按用途多选模型。新任务按负载与轮换调度，同一任务的工具循环和续办固定原模型。"
    :busy="busy"
    @close="runtimeOpen = false"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      id="runtime-form"
      class="dialog-form"
      @submit.prevent="select"
    >
      <fieldset :disabled="busy">
        <section
          v-for="purpose in ['conversation', 'image'] as const"
          :key="purpose"
          class="pool-section"
        >
          <div class="pool-heading">
            <h3>
              {{ purpose === 'conversation' ? '普通会话' : '图片生成与编辑' }}
            </h3>
            <span>{{
              (purpose === 'conversation' ? selected : selectedImage).length
            }}
              / 32 已选</span>
          </div>
          <p>
            {{
              purpose === 'conversation'
                ? '对话、分析、标题和工具循环；看图任务仅调度支持图片输入的模型。'
                : '独立调用 Images API，与会话模型分开调度。'
            }}
          </p>
          <label
            v-for="model in poolOptions(purpose)"
            :key="model.id"
            class="pool-choice"
            :class="{ unavailable: !available(model), selected: (purpose === 'conversation' ? selected : selectedImage).includes(model.id) }"
          >
            <AdminCheckbox
              v-if="purpose === 'conversation'"
              v-model="selected"
              :value="model.id"
              :disabled="!available(model) && !selected.includes(model.id)"
            />
            <AdminCheckbox
              v-else
              v-model="selectedImage"
              :value="model.id"
              :disabled="!available(model) && !selectedImage.includes(model.id)"
            />
            <span><strong>{{ model.name }}</strong><small>{{ model.providerName }} · {{ model.modelId }}</small><small>{{ invocationLabel(model.invocationMode)
            }}{{ model.purpose === 'image' ? ` · ${(model.imageTiers ?? ['1k']).map((tier) => tier.toUpperCase()).join(' / ')}` : ''
            }}{{
              model.purpose === 'conversation' && model.supportsVision
                ? ' · 支持图片输入'
                : ''
            }}{{ available(model) ? '' : ' · 已停用' }}</small></span>
            <b>{{ model.maxConcurrency ?? 4 }} 并发</b>
          </label>
          <p v-if="!poolOptions(purpose).length" class="muted">
            暂无模型，请先添加对应用途的模型。
          </p>
        </section>
        <p class="muted">
          未选任何模型会关闭对应用途。用户统一按公开额度费率计费，上游成本按实际调度模型记录；服务商报错会暂时冷却，排队与冷却参数可在平台配置调整。
        </p>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="runtimeOpen = false">取消</AdminButton><AdminButton
        form="runtime-form"
        type="submit"
        class="primary"
        :disabled="busy"
      >
        {{ busy ? '正在保存…' : '保存配置' }}
      </AdminButton>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="!!confirmation"
    :title="confirmation?.title || ''"
    :description="confirmation?.description"
    :busy="busy"
    compact
    @close="confirmation = null"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <AdminButton :disabled="busy" @click="confirmation = null">取消</AdminButton><AdminButton
        :class="confirmation?.danger ? 'danger' : 'primary'"
        :disabled="busy"
        @click="confirmAction"
      >
        {{
          busy ? '正在处理…' : confirmation?.danger ? '确认删除' : '开始测试'
        }}
      </AdminButton>
    </template>
  </AdminDialog>
</template>

<style scoped>
.image-tiers-field {
  margin-bottom: 20px;
}
.image-tiers-field legend {
  padding: 0;
  margin-bottom: 10px;
  color: #506078;
  font-size: 12px;
}
.image-tier-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 9px;
}
.dialog-form .image-tier-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  padding: 12px;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.image-tier-option.selected {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: #b4c3f3;
}
.pool-section + .pool-section {
  margin-top: 24px;
}
.pool-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.pool-heading h3 {
  font-size: 15px;
  margin: 0;
}
.pool-heading span,
.pool-section p {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.65;
}
.dialog-form .pool-choice {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin: 8px 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  cursor: pointer;
}
.pool-choice.selected {
  background: var(--accent-soft);
  border-color: #b4c3f3;
}
.pool-choice.unavailable {
  opacity: 0.65;
}
.pool-choice > span:not(.admin-checkbox) {
  flex: 1;
  min-width: 0;
}
.pool-choice strong,
.pool-choice small {
  display: block;
  overflow-wrap: anywhere;
}
.pool-choice b {
  color: var(--muted);
  font-size: 11px;
  flex: none;
}
</style>
