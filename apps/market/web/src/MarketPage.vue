<script setup lang="ts">
import type { MarketApp, MarketFilter } from './presentation'
import { appCatalog, backFromApplication, changeInstallation, navigation, openApplication, refreshCatalog, tabLabel } from '@t-box/app-shell-sdk'
import { AppIcon, Modal } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, ref, watch } from 'vue'
import MarketAppCard from './MarketAppCard.vue'
import { displayApp, hasUpdate, installAction, isInstalled, isProcessing, matchesFilter, permissionItems, stateLabel } from './presentation'
import './market.css'

const props = defineProps<{ focusAppId?: string, openRevision?: number }>()
const query = ref('')
const filter = ref<MarketFilter>('all')
const selectedId = ref<string | null>(null)
const selected = computed(() => appCatalog.entries.find((entry) => entry.release.appId === selectedId.value) || null)
const uninstallOpen = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const operationKey = ref(crypto.randomUUID())
const resourceStatus = computed(() => selected.value ? appCatalog.resources?.[selected.value.installation?.releaseId || selected.value.release.releaseId] : undefined)
const targetResources = computed(() => selected.value ? appCatalog.resources?.[selected.value.release.releaseId] : undefined)
const resourceLabel = computed(() => resourceStatus.value?.status === 'ready' ? '本地资源已就绪' : resourceStatus.value?.status === 'preparing' ? `正在准备${resourceStatus.value.total ? ` ${resourceStatus.value.completed || 0}/${resourceStatus.value.total}` : ''}` : resourceStatus.value?.status === 'failed' ? '资源准备失败，打开时可重试修复' : resourceStatus.value?.status === 'unsupported' ? '当前环境使用在线加载' : selected.value?.release.runtime.type === 'shell' ? '随宿主提供' : '首次打开时准备资源')
const filters = computed(() => [
  { id: 'all' as const, label: '全部', count: appCatalog.entries.length },
  { id: 'installed' as const, label: '已安装', count: appCatalog.entries.filter(isInstalled).length },
  { id: 'updates' as const, label: '可更新', count: appCatalog.entries.filter(hasUpdate).length },
])
const entries = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return appCatalog.entries.filter((entry) => {
    const app = displayApp(entry)
    return matchesFilter(entry, filter.value) && `${app.name} ${app.description}`.toLocaleLowerCase().includes(keyword)
  })
})
const sections = computed(() => [
  { id: 'user', title: '可选应用', caption: '按需安装，自由选择', entries: entries.value.filter((entry) => entry.release.kind === 'user') },
  { id: 'system', title: '系统应用', caption: '系统内置，持续更新', entries: entries.value.filter((entry) => entry.release.kind === 'system') },
].filter((section) => section.entries.length))
const emptyTitle = computed(() => query.value.trim() ? '没有找到相关应用' : filter.value === 'updates' ? '当前没有可更新的应用' : filter.value === 'installed' ? '还没有已安装的应用' : '应用正在准备中')
const emptyDescription = computed(() => query.value.trim() ? '试试应用名称或功能关键词。' : filter.value === 'updates' ? '新版本上架后，会出现在这里。' : '在全部应用中发现适合你的工具。')
function show(entry: MarketApp) {
  if (busy.value) {
    return
  }
  selectedId.value = entry.release.appId
  uninstallOpen.value = false
  error.value = ''
  notice.value = ''
  operationKey.value = crypto.randomUUID()
}
function closeDetails() {
  if (busy.value) {
    return
  }
  selectedId.value = null
  error.value = ''
  uninstallOpen.value = false
}
async function activate(entry: MarketApp) {
  if (busy.value || isProcessing(entry)) {
    return
  }
  if (!isInstalled(entry) || hasUpdate(entry)) {
    show(entry)
    return
  }
  error.value = ''
  try {
    await openApplication({ appId: entry.release.appId })
    closeDetails()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '应用打开失败，请重试'
  }
}
async function confirm(uninstall = false) {
  const entry = selected.value
  if (!entry || busy.value || isProcessing(entry) || (uninstall && entry.release.kind === 'system')) {
    return
  }
  const action = uninstall ? 'uninstall' : installAction(entry)
  // Opening an installed app is separate from an explicit uninstall confirmation.
  if (!uninstall && action === 'uninstall') {
    await activate(entry)
    return
  }
  busy.value = true
  error.value = ''
  try {
    await changeInstallation(entry, action, operationKey.value)
    notice.value = `${displayApp(entry).name}的${action === 'uninstall' ? '卸载' : action === 'update' ? '更新' : '安装'}请求已提交`
    selectedId.value = null
    uninstallOpen.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  } finally {
    busy.value = false
  }
}
function requestUninstall() {
  uninstallOpen.value = true
  error.value = ''
  operationKey.value = crypto.randomUUID()
}
function resetFilters() {
  query.value = ''
  filter.value = 'all'
}
let focusedRevision = ''
watch(() => [props.focusAppId, props.openRevision, appCatalog.revision] as const, () => {
  const focus = `${props.openRevision}:${props.focusAppId}`
  if (!props.focusAppId || focusedRevision === focus) {
    return
  }
  const entry = appCatalog.entries.find((entry) => entry.release.appId === props.focusAppId)
  if (entry) {
    focusedRevision = focus
    show(entry)
  }
}, { immediate: true })
</script>

<template>
  <section class="market-page" aria-label="应用市场">
    <ApplicationHeader
      title="应用市场"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    >
      <template #actions><button
        class="market-refresh"
        :disabled="appCatalog.loading || busy"
        aria-label="刷新应用列表"
        title="刷新应用列表"
        @click="refreshCatalog()"
      ><AppIcon
        name="refresh"
        :size="18"
        :class="{ 'market-spinning': appCatalog.loading }"
      /></button></template>
    </ApplicationHeader>
    <div class="market-toolbar">
      <div class="market-search"><AppIcon name="search" :size="18" /><input
        v-model="query"
        type="search"
        placeholder="搜索应用或功能"
        aria-label="搜索应用"
        autocomplete="off"
      ><button
        v-if="query"
        aria-label="清空搜索"
        @click="query = ''"
      ><AppIcon name="close" :size="15" /></button></div>
      <div
        class="market-filters"
        role="group"
        aria-label="应用筛选"
      ><button
        v-for="item in filters"
        :key="item.id"
        :aria-pressed="filter === item.id"
        @click="filter = item.id"
      ><span>{{ item.label }}</span><small>{{ item.count }}</small></button></div>
    </div>
    <p
      v-if="appCatalog.error"
      class="market-feedback market-feedback--error"
      role="alert"
    ><AppIcon name="warning" :size="16" /><span>{{ appCatalog.error }}</span><button :disabled="appCatalog.loading" @click="refreshCatalog()">重试</button></p>
    <p
      v-else-if="notice"
      class="market-feedback"
      role="status"
    ><AppIcon name="check" :size="16" /><span>{{ notice }}</span><button aria-label="关闭操作提示" @click="notice = ''"><AppIcon name="close" :size="14" /></button></p>
    <p
      v-if="error && !selected"
      class="market-feedback market-feedback--error"
      role="alert"
    >{{ error }}</p>
    <div class="market-results" :aria-busy="appCatalog.loading">
      <div
        v-if="appCatalog.loading && !appCatalog.entries.length"
        class="market-skeletons"
        role="status"
      ><span class="sr-only">正在加载应用…</span><div
        v-for="item in 4"
        :key="item"
        class="market-skeleton"
        aria-hidden="true"
      ><i /><span><b /><em /></span></div></div>
      <template v-else>
        <section
          v-for="section in sections"
          :key="section.id"
          class="market-section"
          :aria-labelledby="`market-section-${section.id}`"
        >
          <header class="market-section-heading"><h2 :id="`market-section-${section.id}`">{{ section.title }}<span>{{ section.entries.length }}</span></h2><p>{{ section.caption }}</p></header>
          <div class="market-grid" :class="{ 'market-grid--optional': section.id === 'user' }"><MarketAppCard
            v-for="entry in section.entries"
            :key="entry.release.appId"
            :entry="entry"
            :busy="busy"
            @inspect="show"
            @activate="activate"
          /></div>
        </section>
        <div
          v-if="!entries.length && !appCatalog.error"
          class="market-empty"
          role="status"
        ><span class="market-empty-icon"><AppIcon :name="filter === 'updates' && !query.trim() ? 'check' : 'search'" :size="26" /></span><h2>{{ emptyTitle }}</h2><p>{{ emptyDescription }}</p><button v-if="query || filter !== 'all'" @click="resetFilters">查看全部应用<AppIcon name="right" :size="15" /></button></div>
      </template>
    </div>
    <Modal
      :open="Boolean(selected) && !uninstallOpen"
      title="应用详情"
      :busy="busy"
      @close="closeDetails"
    >
      <div v-if="selected" class="market-detail">
        <div class="market-detail-identity"><LauncherIcon
          :app-id="selected.release.appId"
          :icon="displayApp(selected).icon"
          :icon-asset="displayApp(selected).iconAsset"
          :icon-variant="displayApp(selected).iconVariant"
        /><div><h3>{{ displayApp(selected).name }}</h3><p>{{ selected.release.kind === 'system' ? '系统应用' : '独立应用' }}<span v-if="selected.release.manifest.skillIds.length"> · 支持 AI 工具</span></p></div></div>
        <p class="market-detail-description">{{ displayApp(selected).description }}</p>
        <dl class="market-detail-facts"><div><dt>最新版本</dt><dd>v{{ selected.release.manifest.version }}</dd></div><div><dt>安装状态</dt><dd>{{ stateLabel(selected) }}</dd></div><div><dt>本机资源</dt><dd>{{ resourceLabel }}</dd></div><div v-if="hasUpdate(selected) && targetResources?.status === 'ready'"><dt>更新包</dt><dd>已在后台准备好</dd></div></dl>
        <div v-if="selected.releaseNotes" class="market-release-notes"><h4>更新说明</h4><p>{{ selected.releaseNotes }}</p></div>
        <p v-if="selected.issue || selected.installation?.error" class="market-detail-warning">{{ selected.issue || selected.installation?.error }}</p>
        <div v-if="!isInstalled(selected) || hasUpdate(selected)" class="market-permissions"><h4>{{ hasUpdate(selected) ? '更新后的应用权限' : '安装后允许此应用' }}</h4><ul v-if="selected.release.permissions.length"><li v-for="permission in permissionItems(selected)" :key="permission"><AppIcon name="check" :size="14" /><span>{{ permission }}</span></li></ul><p v-else>无需额外权限。</p></div>
        <p v-if="selected.release.kind === 'system'" class="market-detail-note"><AppIcon name="lock" :size="13" />系统应用随 OS 提供，支持更新，不可卸载。</p>
        <p
          v-if="error"
          class="market-detail-error"
          role="alert"
        >{{ error }}</p>
      </div>
      <template #footer><div v-if="selected" class="market-detail-actions"><button
        v-if="isInstalled(selected) && selected.release.kind === 'user' && !isProcessing(selected)"
        class="market-uninstall-link"
        :disabled="busy"
        @click="requestUninstall"
      ><AppIcon name="trash" :size="15" />卸载应用</button><button
        class="market-detail-primary"
        :disabled="busy || isProcessing(selected)"
        @click="confirm()"
      >{{ busy ? targetResources?.status === 'preparing' ? `准备资源${targetResources.total ? ` ${targetResources.completed || 0}/${targetResources.total}` : '…'}` : '正在提交…' : isProcessing(selected) ? '正在处理…' : hasUpdate(selected) ? '同意权限并更新' : isInstalled(selected) ? '打开应用' : '同意权限并安装' }}</button></div></template>
    </Modal>
    <Modal
      :open="uninstallOpen && Boolean(selected)"
      title="卸载这个应用？"
      :busy="busy"
      @close="!busy && (uninstallOpen = false)"
    >
      <p v-if="selected" class="market-uninstall-description">「{{ displayApp(selected).name }}」会从桌面移除，AI 将无法继续使用它的工具。已有数据会保留，重新安装后可继续使用。</p>
      <p
        v-if="error"
        class="market-detail-error"
        role="alert"
      >{{ error }}</p>
      <template #footer><button
        class="button button-secondary"
        :disabled="busy"
        @click="uninstallOpen = false"
      >取消</button><button
        class="button button-danger"
        :disabled="busy"
        @click="confirm(true)"
      >{{ busy ? '正在提交…' : '确认卸载' }}</button></template>
    </Modal>
  </section>
</template>
