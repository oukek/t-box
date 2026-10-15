<script setup lang="ts">
import type { DesktopApplication } from '@t-box/shared'
import { desktopIconSizes } from '@t-box/app-contracts'
import { moveDesktopApp } from '@t-box/shared'
import { AppIcon, Modal } from '@t-box/ui-kit'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { repairInstallation } from '../../core/app-runtime/catalog'
import { getApplication, presentApplication } from '../../core/applications'
import {
  openApplication,
  openApplicationCapabilities,
} from '../../core/navigation'
import { preferences } from '../../core/preferences'
import { identity } from '../../core/session'
import { useAppDrag } from './useAppDrag'
import { useDesktop } from './useDesktop'

const desktop = useDesktop()
const iconStyle = computed(() => {
  const size = desktopIconSizes[preferences.iconSize]
  return {
    '--desktop-columns': size.columns,
    '--desktop-icon-pc': `${size.pc}px`,
    '--desktop-icon-mobile': `${size.mobile}px`,
  }
})
const editing = ref(false)
const order = ref<string[]>([])
const info = ref<DesktopApplication | null>(null)
const repairing = ref(false)
const repairError = ref('')
async function repair(appId: string) {
  repairing.value = true
  repairError.value = ''
  try {
    await repairInstallation(appId)
    desktop.retry()
    info.value = null
  } catch (cause) {
    repairError.value = cause instanceof Error ? cause.message : '修复失败，请重试'
  } finally {
    repairing.value = false
  }
}
const now = ref(new Date())
const clockTimer = setInterval(() => {
  now.value = new Date()
}, 15000)
onBeforeUnmount(() => clearInterval(clockTimer))
const time = computed(() =>
  now.value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
)
const date = computed(() =>
  now.value.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
)
const apps = computed(() =>
  order.value.flatMap((id) => {
    const entry = desktop.state.applications.find((x) => x.manifest.id === id)
    return entry && getApplication(id)
      ? [{ ...entry, manifest: presentApplication(entry.manifest) }]
      : []
  }),
)
const sort = useAppDrag(
  order,
  editing,
  () => desktop.state.ready,
  desktop.reorder,
)
watch(
  () => desktop.state.appIds,
  (ids) => {
    if (!sort.drag.appId) {
      order.value = [...ids]
    }
  },
  { immediate: true },
)
watch([desktop.device, () => identity.user?.id], () => {
  sort.cancel()
  editing.value = false
  info.value = null
  order.value = [...desktop.state.appIds]
})
const draggedApp = computed(() =>
  apps.value.find((x) => x.manifest.id === sort.drag.appId),
)
function launch(app: DesktopApplication) {
  if (sort.consumeClick()) {
    return
  }
  if (editing.value || (app.installation.status && app.installation.status !== 'active')) {
    repairError.value = ''
    info.value = app
  } else {
    void openApplication({ appId: app.manifest.id })
  }
}
function finish() {
  sort.cancel()
  editing.value = false
}
function move(appId: string, direction: number) {
  const target = order.value[order.value.indexOf(appId) + direction]
  if (!target || !desktop.state.ready) {
    return
  }
  order.value = moveDesktopApp(order.value, appId, target)
  desktop.reorder(order.value)
}
function keyboard(event: KeyboardEvent, appId: string) {
  if (!editing.value || !['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    return
  }
  event.preventDefault()
  move(appId, event.key === 'ArrowLeft' ? -1 : 1)
}
const status = computed(() =>
  desktop.state.saving
    ? '正在保存排序…'
    : desktop.state.loading
      ? '正在同步桌面…'
      : '',
)
</script>

<template>
  <section
    class="os-desktop"
    :style="iconStyle"
    aria-label="OS 应用桌面"
    :class="{ 'is-editing': editing }"
    @keydown.esc="finish"
  >
    <header class="desktop-statusbar">
      <span class="desktop-brand"><span class="desktop-brand-dot" />T BOX <span>OS</span></span>
      <button
        v-if="editing"
        class="desktop-control is-done"
        @click="finish"
      >
        完成
      </button>
      <button
        v-else
        class="desktop-control"
        :disabled="!desktop.state.ready"
        @click="editing = true"
      >
        <AppIcon name="apps" :size="15" />整理
      </button>
    </header>
    <div class="desktop-clock">
      <time :datetime="now.toISOString()">{{ time }}</time>
      <p>{{ date }}</p>
    </div>
    <div
      v-if="desktop.state.error"
      class="desktop-feedback"
      role="alert"
    >
      <AppIcon name="warning" :size="16" /><span>{{ desktop.state.error }}</span><button @click="desktop.retry">重试</button>
    </div>
    <p class="desktop-sort-hint" aria-live="polite">
      {{ status || (editing ? "拖动图标调整顺序，或点图标查看更多操作" : "") }}
    </p>
    <div
      class="desktop-grid"
      role="list"
      aria-label="已安装应用"
      @pointermove="sort.move"
      @pointerup="sort.end"
      @pointercancel="sort.cancel"
      @lostpointercapture="sort.lost"
      @pointerleave="sort.leave"
    >
      <article
        v-for="app in apps"
        :key="app.manifest.id"
        role="listitem"
        class="desktop-app"
        :class="{ 'is-dragging': sort.drag.appId === app.manifest.id }"
        :data-app-id="app.manifest.id"
      >
        <button
          class="desktop-app-launch"
          :aria-label="
            editing
              ? `整理${app.manifest.name}，左右方向键移动`
              : `打开${app.manifest.name}`
          "
          :aria-describedby="editing ? 'desktop-sort-help' : undefined"
          @pointerdown="sort.start($event, app.manifest.id)"
          @keydown="keyboard($event, app.manifest.id)"
          @click="launch(app)"
          @contextmenu.prevent="info = app"
        >
          <LauncherIcon
            :app-id="app.manifest.id"
            :icon="app.manifest.icon"
            :day="now.getDate()"
          />
          <span class="desktop-app-name">{{ app.manifest.name }}</span>
          <small v-if="app.installation.status && app.installation.status !== 'active'" class="desktop-app-state">{{ app.installation.status === 'installing' ? '准备中…' : '暂不可用' }}</small>
        </button>
        <button
          v-if="editing"
          class="desktop-app-info"
          :aria-label="`${app.manifest.name}应用信息`"
          @click.stop="info = app"
        >
          <AppIcon name="info" :size="13" />
        </button>
      </article>
    </div>
    <p
      v-if="editing"
      id="desktop-sort-help"
      class="desktop-footnote"
    >
      {{ desktop.device.value === "mobile" ? "移动端" : "PC" }}桌面单独保存 ·
      系统应用不可卸载
    </p>
    <p v-else class="desktop-footnote">长按图标整理桌面</p>
    <div
      v-if="draggedApp"
      class="desktop-drag-ghost"
      :style="{
        ...iconStyle,
        left: `${sort.drag.x}px`,
        top: `${sort.drag.y}px`,
      }"
    >
      <LauncherIcon
        :app-id="draggedApp.manifest.id"
        :icon="draggedApp.manifest.icon"
        :day="now.getDate()"
      /><span>{{ draggedApp.manifest.name }}</span>
    </div>
    <Modal
      :open="Boolean(info)"
      :title="info?.manifest.name || '应用信息'"
      @close="info = null"
    >
      <div v-if="info" class="desktop-app-details">
        <div class="desktop-detail-identity">
          <LauncherIcon
            :app-id="info.manifest.id"
            :icon="info.manifest.icon"
            :day="now.getDate()"
          />
          <div>
            <strong>{{ info.manifest.name }}</strong>
            <p>{{ info.manifest.description }}</p>
          </div>
        </div>
        <dl>
          <div><dt>状态</dt><dd>{{ info.installation.status === 'installing' ? '正在安装' : info.installation.status === 'failed' ? '暂不可用' : '已安装' }}</dd></div>
          <div>
            <dt>类型</dt>
            <dd>
              {{
                info.installation.kind === "system" ? "系统应用" : "用户应用"
              }}
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{{ info.manifest.version }}</dd>
          </div>
          <div>
            <dt>AI 能力</dt>
            <dd>{{ info.aiAvailable ? "可在 AI 对话中使用" : "独立使用" }}</dd>
          </div>
        </dl>
        <p
          v-if="info.installation.error || repairError"
          class="form-error"
          role="alert"
        >{{ repairError || info.installation.error }}</p>
        <button
          v-if="info.installation.status && info.installation.status !== 'active'"
          class="button button-primary"
          :disabled="repairing"
          @click="repair(info.manifest.id)"
        >{{ repairing ? '正在重试…' : '重试安装' }}</button>
        <button
          v-if="info.aiAvailable"
          class="button button-secondary desktop-capabilities"
          @click="
            openApplicationCapabilities(info.manifest.id);
            info = null;
          "
        >
          查看工具与技能<AppIcon name="right" :size="15" />
        </button>
        <div v-if="editing" class="desktop-move-actions">
          <button
            class="button button-secondary"
            :disabled="
              order.indexOf(info.manifest.id) === 0 || !desktop.state.ready
            "
            @click="move(info.manifest.id, -1)"
          > 向前移动</button><button
            class="button button-secondary"
            :disabled="
              order.indexOf(info.manifest.id) === order.length - 1
                || !desktop.state.ready
            "
            @click="move(info.manifest.id, 1)"
          >
            向后移动
          </button>
        </div>
        <button
          v-if="info.installation.uninstallable"
          class="button button-secondary"
          @click="
            info = null;
            openApplication({ appId: 'market' });
          "
        >
          管理应用
        </button>
        <div class="desktop-uninstall">
          <AppIcon name="lock" :size="16" /><span>{{
            info.installation.kind === "system"
              ? "系统应用不可卸载"
              : "可在应用市场管理与卸载"
          }}</span>
        </div>
      </div>
    </Modal>
  </section>
</template>
