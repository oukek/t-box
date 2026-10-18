<script setup lang="ts">
import type {
  ApplicationCapabilities,
  ApplicationToolEffect,
} from '@t-box/shared'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { applicationModules } from '../../applications/registry'
import { appCatalog } from '../../core/app-runtime/catalog'
import { getApplication } from '../../core/applications'
import { navigateTab } from '../../core/navigation'
import { request } from '../../core/network'
import { ErrorCode } from '../../error-codes.js'

const props = defineProps<{ appId: string }>()
const data = ref<ApplicationCapabilities | null>(null)
const loading = ref(true)
const error = ref('')
const tab = ref<'tools' | 'skills' | 'agents' | 'interactions'>('tools')
const app = computed(() => getApplication(props.appId))
const effects: Record<ApplicationToolEffect, string> = {
  read: '读取数据',
  write: '写入数据',
  external: '外部服务',
  ui: '界面操作',
  configuration: '运行配置',
}
const tabs = computed(
  () =>
    [
      { id: 'tools', title: '工具', count: data.value?.tools.length || 0 },
      { id: 'skills', title: '技能', count: data.value?.skills.length || 0 },
      { id: 'agents', title: 'Agent', count: data.value?.agents.length || 0 },
      {
        id: 'interactions',
        title: '前端交互',
        count: data.value?.interactions.length || 0,
      },
    ] as const,
)
const supported = (name: string) =>
  appCatalog.entries
    .find((e) => e.release.appId === props.appId)
    ?.release
    .clientTools
    .includes(name) ||
    Object.hasOwn(
      applicationModules.find((module) => module.manifest.id === props.appId)?.ai?.clientTools || {},
      name,
    )
const toolTitle = (name: string) =>
  data.value?.tools.find((tool) => tool.name === name)?.title || name
const skillTitle = (id: string) =>
  data.value?.skills.find((skill) => skill.id === id)?.title || id
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  const current = (controller = new AbortController())
  loading.value = true
  error.value = ''
  data.value = null
  try {
    const result = await request<{ data: ApplicationCapabilities }>(
      `/applications/${encodeURIComponent(props.appId)}/capabilities`,
      { signal: current.signal },
    )
    if (current.signal.aborted) {
      return
    }
    if (
      result.data.contractVersion !== APPLICATION_CONTRACT_VERSION ||
      result.data.manifest.id !== props.appId
    ) {
      throw ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED()
    }
    data.value = result.data
  } catch (cause) {
    if (!current.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '无法读取应用能力'
    }
  } finally {
    if (controller === current) {
      loading.value = false
    }
  }
}
watch(
  () => props.appId,
  () => {
    tab.value = 'tools'
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="capabilities-page">
    <ApplicationHeader
      :title="`${app?.name || '应用'}能力`"
      back-label="应用"
      @back="navigateTab('applications')"
    />
    <div class="capabilities-intro">
      <span class="capabilities-app-icon"><AppIcon
        :name="app?.icon || 'apps'"
        :size="25"
      /></span>
      <div>
        <p>{{ app?.description }}</p>
        <span>应用声明能力，AI 按需调用。</span>
      </div>
      <small v-if="data">v{{ data.manifest.version }}</small>
    </div>
    <div
      v-if="loading"
      class="capabilities-state"
      role="status"
    >
      正在读取应用能力…
    </div>
    <div
      v-else-if="error"
      class="capabilities-state"
      role="alert"
    >
      <p>{{ error }}</p>
      <button class="button button-secondary" @click="load">重新加载</button>
    </div>
    <template v-else-if="data">
      <nav class="capabilities-tabs" aria-label="应用能力分类">
        <button
          v-for="item in tabs"
          :key="item.id"
          :aria-current="tab === item.id ? 'page' : undefined"
          :class="{ active: tab === item.id }"
          @click="tab = item.id"
        >
          {{ item.title }}<span>{{ item.count }}</span>
        </button>
      </nav>
      <p class="capabilities-caption">
        {{
          tab === "tools"
            ? "模型可调用的操作。执行时仍需检查权限，查看此列表不会执行工具。"
            : tab === "skills"
              ? "将工具组织为任务流程，AI 根据任务按需启用。"
              : tab === "agents"
                ? "负责该应用任务的专业助手，只使用所属应用授权的能力。"
                : "由应用执行的授权和确认界面，不能由模型替用户完成。"
        }}
      </p>
      <div v-if="tab === 'tools'" class="capabilities-list">
        <article
          v-for="tool in data.tools"
          :key="tool.name"
          class="capability-card"
        >
          <header>
            <h2>{{ tool.title }}</h2>
            <span class="capability-location" :class="tool.execution">{{
              tool.execution === "server" ? "后端执行" : "前端执行"
            }}</span>
          </header>
          <p>{{ tool.description }}</p>
          <div class="capability-policies">
            <span>{{ effects[tool.effect] }}</span><span v-if="tool.resourceAuthorization"><AppIcon name="lock" :size="12" />资源权限校验</span><span v-if="tool.confirmation"><AppIcon name="check" :size="12" />需用户确认</span><span v-if="tool.idempotent">重复操作防护</span>
          </div>
          <details class="capability-details">
            <summary>
              调用规范<code>{{ tool.name }}</code>
            </summary>
            <pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
          </details>
        </article>
        <p v-if="!data.tools.length" class="capabilities-state">
          该应用尚未提供 AI 工具
        </p>
      </div>
      <div v-else-if="tab === 'skills'" class="capabilities-list">
        <article
          v-for="skill in data.skills"
          :key="skill.id"
          class="capability-card"
        >
          <header>
            <h2>{{ skill.title }}</h2>
            <small>v{{ skill.version }}</small>
          </header>
          <p>{{ skill.description }}</p>
          <div class="capability-linked-tools">
            <span v-for="name in skill.tools" :key="name">{{
              toolTitle(name)
            }}</span>
          </div>
          <small class="capability-id">{{ skill.id }}</small>
        </article>
        <p v-if="!data.skills.length" class="capabilities-state">
          该应用尚未提供技能
        </p>
      </div>
      <div v-else-if="tab === 'agents'" class="capabilities-list">
        <article
          v-for="agent in data.agents"
          :key="agent.id"
          class="capability-card"
        >
          <header>
            <h2>{{ agent.title }}</h2>
            <small>v{{ agent.version }}</small>
          </header>
          <p>{{ agent.description }}</p>
          <div class="capability-linked-tools">
            <span v-for="id in agent.skillIds" :key="id">{{
              skillTitle(id)
            }}</span>
          </div>
          <small class="capability-id">{{ agent.id }}</small>
        </article>
        <p v-if="!data.agents.length" class="capabilities-state">
          该应用尚未提供专业 Agent
        </p>
      </div>
      <div v-else class="capabilities-list">
        <article
          v-for="interaction in data.interactions"
          :key="interaction.name"
          class="capability-card"
        >
          <header>
            <h2>{{ interaction.title }}</h2>
            <span class="capability-location client">{{
              supported(interaction.name) ? "当前版本支持" : "当前版本不支持"
            }}</span>
          </header>
          <p>{{ interaction.description }}</p>
          <div class="capability-policies">
            <span>前端执行</span><span>用户交互</span><span>非模型直接调用</span>
          </div>
          <details class="capability-details">
            <summary>
              交互规范<code>{{ interaction.name }}</code>
            </summary>
            <pre>{{ JSON.stringify(interaction.inputSchema, null, 2) }}</pre>
          </details>
        </article>
        <p v-if="!data.interactions.length" class="capabilities-state">
          该应用没有额外的前端交互
        </p>
      </div>
      <p class="capabilities-footnote">
        这些是应用提供的能力，实际可用范围取决于登录状态、资源权限和 AI
        服务配置。
      </p>
    </template>
  </section>
</template>

<style scoped>
.capabilities-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 10px 0 30px;
}
.capabilities-intro {
  display: flex;
  align-items: center;
  gap: 13px;
  margin: 24px 0;
}
.capabilities-app-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: #e9f2e8;
  color: #5b8e61;
  flex-shrink: 0;
}
.capabilities-intro > div {
  flex: 1;
}
.capabilities-intro p {
  font-size: 13px;
  color: #365943;
  margin: 0 0 5px;
}
.capabilities-intro span:not(.capabilities-app-icon),
.capabilities-intro small {
  font-size: 11px;
  color: #708578;
}
.capabilities-tabs {
  display: flex;
  border-bottom: 1px solid #e1e9e2;
  gap: 24px;
  overflow-x: auto;
}
.capabilities-tabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #708578;
  font-size: 13px;
  white-space: nowrap;
}
.capabilities-tabs button.active {
  color: #365943;
  border-bottom-color: #54736d;
}
.capabilities-tabs button span {
  font-size: 10px;
  padding: 2px 6px;
  background: #e8eeeb;
  border-radius: 5px;
}
.capabilities-caption,
.capabilities-footnote {
  font-size: 11px;
  line-height: 1.8;
  color: #708578;
  margin: 16px 0;
}
.capabilities-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.capability-card {
  padding: 18px;
  background: #fff;
  border: 1px solid #e1e9e2;
  border-radius: 14px;
  min-width: 0;
}
.capability-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.capability-card h2 {
  font-size: 14px;
  font-weight: 550;
  color: #365943;
  margin: 0;
}
.capability-card header small {
  font-size: 10px;
  color: #708578;
}
.capability-card > p {
  font-size: 12px;
  line-height: 1.9;
  color: #708578;
  margin: 12px 0;
}
.capability-location {
  padding: 4px 7px;
  font-size: 10px;
  white-space: nowrap;
  border-radius: 6px;
}
.capability-location.server {
  background: #edf5ef;
  color: #54736d;
}
.capability-location.client {
  background: #eef2f7;
  color: #607489;
}
.capability-policies {
  display: flex;
  gap: 7px 10px;
  flex-wrap: wrap;
  color: #708578;
  font-size: 10px;
}
.capability-policies span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.capability-details {
  margin-top: 15px;
  padding-top: 12px;
  border-top: 1px solid #edf2eb;
}
.capability-details summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
  color: #54736d;
  font-size: 11px;
}
.capability-details code,
.capability-id {
  font:
    10px ui-monospace,
    monospace;
  color: #87988b;
  overflow-wrap: anywhere;
}
.capability-details pre {
  overflow: auto;
  max-height: 260px;
  padding: 12px;
  margin: 12px 0 0;
  border-radius: 8px;
  background: #f6f8f7;
  font:
    11px/1.7 ui-monospace,
    monospace;
  color: #526760;
}
.capability-linked-tools {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.capability-linked-tools span {
  padding: 5px 7px;
  border-radius: 6px;
  background: #f2f6f3;
  color: #54736d;
  font-size: 10px;
}
.capabilities-state {
  padding: 35px 12px;
  font-size: 13px;
  text-align: center;
  color: #708578;
}
.capabilities-tabs button:focus-visible,
.capability-details summary:focus-visible {
  outline: 2px solid #54736d;
  outline-offset: 3px;
}
@media (max-width: 700px) {
  .capabilities-page {
    padding: 8px 4px 24px;
  }
  .capabilities-list {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .capabilities-tabs {
    gap: 21px;
  }
  .capabilities-intro {
    margin: 20px 0;
  }
}
</style>
