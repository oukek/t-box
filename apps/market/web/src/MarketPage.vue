<script setup lang="ts">
import type { DeepReadonly } from "vue";
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import type { MarketEntry } from "@t-box/app-contracts";
import { Modal } from "@t-box/ui-kit";
import LauncherIcon from "@t-box/ui-kit/LauncherIcon.vue";
import { AppIcon } from "@t-box/ui-kit";
import {
  appCatalog,
  refreshCatalog,
  changeInstallation,
} from "@t-box/app-shell-sdk";
import { openApplication } from "@t-box/app-shell-sdk";
import { presentApplication } from "@t-box/app-shell-sdk";
const display = (entry: DeepReadonly<MarketEntry>) =>
  presentApplication(entry.release.manifest);
const query = ref(""),
  selected = ref<DeepReadonly<MarketEntry> | null>(null),
  busy = ref(false),
  error = ref("");
const operationKey = ref(crypto.randomUUID());
const entries = computed(() =>
  appCatalog.entries.filter((e) =>
    (display(e).name + display(e).description).includes(query.value.trim()),
  ),
);
const installed = (e: DeepReadonly<MarketEntry>) =>
  e.installation?.status === "active";
const updating = (e: DeepReadonly<MarketEntry>) =>
  Boolean(e.installation?.operationId);
const action = (e: DeepReadonly<MarketEntry>) =>
  installed(e)
    ? e.installation!.releaseId !== e.release.releaseId
      ? "update"
      : "uninstall"
    : "install";
const label = (e: DeepReadonly<MarketEntry>) =>
  updating(e)
    ? "正在处理"
    : installed(e)
      ? e.installation!.releaseId !== e.release.releaseId
        ? "更新"
        : "打开"
      : "安装";
function show(entry: DeepReadonly<MarketEntry>) {
  selected.value = entry;
  error.value = "";
  operationKey.value = crypto.randomUUID();
}
const permissions: Record<string, string> = {
  "calculator.calculate": "执行数学计算",
  storage: "保存应用偏好与本地记录",
};
async function confirm() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  try {
    await changeInstallation(
      selected.value,
      action(selected.value),
      operationKey.value,
    );
    selected.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
const poll = setInterval(() => {
  if (appCatalog.entries.some((e) => e.installation?.operationId))
    void refreshCatalog().then(() =>
      window.dispatchEvent(new Event("tbox:applications-changed")),
    );
}, 5000);
onMounted(() => void refreshCatalog());
onBeforeUnmount(() => clearInterval(poll));
</script>
<template>
  <section class="market-page">
    <div class="market-intro">
      <p class="market-eyebrow">为你的 OS 添加能力</p>
      <h2>工具，随手可用。</h2>
      <p>一个入口，打开你的日常应用。</p>
    </div>
    <label class="market-search"
      ><AppIcon name="search" :size="18" /><input
        v-model="query"
        placeholder="搜索应用"
        aria-label="搜索应用"
    /></label>
    <p v-if="appCatalog.error" role="alert">
      {{ appCatalog.error }}
      <button class="button button-secondary" @click="refreshCatalog">
        重试
      </button>
    </p>
    <div class="market-section-title">
      <h3>全部应用</h3>
      <span>{{ entries.length }} 个应用</span>
    </div>
    <div class="market-list">
      <article
        v-for="entry in entries"
        :key="entry.release.appId"
        class="market-row"
      >
        <button class="market-identity" @click="show(entry)">
          <LauncherIcon
            :app-id="entry.release.appId"
            :icon="display(entry).icon"
            :day="new Date().getDate()"
          /><span
            ><strong>{{ display(entry).name }}</strong
            ><small>{{ display(entry).description }}</small
            ><em
              >{{ entry.release.kind === "system" ? "系统应用" : "官方应用" }} ·
              v{{ entry.release.manifest.version
              }}<template v-if="entry.release.manifest.skillIds.length">
                · 支持 AI 工具</template
              ></em
            ></span
          ></button
        ><button
          class="market-action"
          :disabled="updating(entry) || busy"
          @click="
            installed(entry) &&
            entry.installation!.releaseId === entry.release.releaseId
              ? openApplication({ appId: entry.release.appId })
              : show(entry)
          "
        >
          {{ label(entry) }}
        </button>
      </article>
    </div>
    <p v-if="!entries.length && !appCatalog.loading" class="market-empty">
      没有找到这个应用，换个关键词试试。
    </p>
    <Modal
      :open="Boolean(selected)"
      :title="selected ? display(selected).name : '应用详情'"
      :busy="busy"
      @close="!busy && (selected = null)"
      ><div v-if="selected" class="market-detail">
        <p>{{ display(selected).description }}</p>
        <dl>
          <div>
            <dt>版本</dt>
            <dd>{{ selected.release.manifest.version }}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              {{
                updating(selected)
                  ? "等待服务确认"
                  : installed(selected)
                    ? "已安装"
                    : selected.installation?.status === "revoked"
                      ? "已卸载"
                      : "未安装"
              }}
            </dd>
          </div>
        </dl>
        <template v-if="action(selected) !== 'uninstall'"
          ><h4>应用权限</h4>
          <ul v-if="selected.release.permissions.length">
            <li
              v-for="permission in selected.release.permissions"
              :key="permission"
            >
              {{ permissions[permission] || permission }}
            </li>
          </ul>
          <p v-else>无需额外权限。</p></template
        >
        <p v-else-if="selected.release.kind === 'user'">
          卸载后停止提供 AI 工具，已有数据会保留。重新安装后可以继续使用。
        </p>
        <p v-if="error" role="alert" class="market-error">{{ error }}</p>
        <button
          v-if="
            !updating(selected) &&
            (selected.release.kind === 'user' ||
              action(selected) !== 'uninstall')
          "
          class="button"
          :class="
            action(selected) === 'uninstall'
              ? 'button-secondary'
              : 'button-primary'
          "
          :disabled="busy"
          @click="confirm"
        >
          {{
            busy
              ? "正在处理…"
              : action(selected) === "uninstall"
                ? "卸载应用"
                : action(selected) === "update"
                  ? "确认更新"
                  : "同意权限并安装"
          }}
        </button>
        <p v-else class="market-note">
          {{
            selected.release.kind === "system"
              ? "系统应用不可卸载。"
              : "正在核对服务结果，可以离开此页面。"
          }}
        </p>
      </div></Modal
    >
  </section>
</template>
<style scoped>
.market-page {
  --market-ink: #233347;
  --market-muted: #718092;
  --market-blue: #386ce6;
  --market-line: #e8edf4;
  --market-paper: #fff;
  max-width: 840px;
  width: 100%;
  margin: 0 auto;
  padding: 20px 18px 32px;
  color: var(--market-ink);
}
.market-intro {
  padding: 14px 0 26px;
}
.market-eyebrow {
  color: var(--market-blue);
  font-size: 12px;
  letter-spacing: 0.08em;
  margin: 0 0 10px;
}
.market-intro h2 {
  font-size: 26px;
  letter-spacing: -0.06em;
  margin: 0 0 9px;
  font-weight: 650;
}
.market-intro > p:last-child {
  font-size: 13px;
  color: var(--market-muted);
  margin: 0;
}
.market-search {
  display: flex;
  gap: 10px;
  align-items: center;
  background: #edf2f8;
  padding: 0 14px;
  border-radius: 12px;
  height: 42px;
  color: var(--market-muted);
}
.market-search input {
  border: 0 !important;
  background: none !important;
  outline: none !important;
  box-shadow: none !important;
  width: 100%;
  min-width: 0;
  font-size: 14px;
  padding: 0;
}
.market-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 25px 0 8px;
}
.market-section-title h3 {
  font-size: 15px;
  margin: 0;
}
.market-section-title span {
  font-size: 12px;
  color: var(--market-muted);
}
.market-list {
  background: var(--market-paper);
  border-radius: 16px;
  padding: 0 14px;
}
.market-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--market-line);
  padding: 18px 0;
}
.market-row:last-child {
  border-bottom: 0;
}
.market-identity {
  border: 0;
  padding: 0;
  text-align: left;
  background: none;
  display: flex;
  gap: 14px;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.market-identity :deep(.launcher-icon) {
  --icon-size: 54px;
}
.market-identity > span {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.market-identity strong {
  font-size: 15px;
  font-weight: 600;
}
.market-identity small {
  font-size: 12px;
  line-height: 1.5;
  color: var(--market-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.market-identity em {
  font-size: 10px;
  font-style: normal;
  color: #8797a9;
}
.market-action {
  flex-shrink: 0;
  border: 0;
  border-radius: 24px;
  background: #edf3ff;
  color: var(--market-blue);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 15px;
  min-width: 60px;
}
.market-action:disabled {
  opacity: 0.55;
}
.market-detail dl > div {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--market-line);
  font-size: 13px;
}
.market-detail dd {
  margin: 0;
}
.market-detail p,
.market-detail li {
  font-size: 13px;
  line-height: 1.8;
  color: var(--market-muted);
}
.market-detail h4 {
  font-size: 14px;
  margin: 20px 0 8px;
}
.market-detail .button {
  width: 100%;
  margin-top: 16px;
}
.market-error {
  color: #b64c43 !important;
}
.market-empty {
  text-align: center;
  color: var(--market-muted);
  font-size: 13px;
  padding: 25px;
}
.market-note {
  margin-bottom: 0;
}
@media (max-width: 600px) {
  .market-page {
    padding: 12px 12px 28px;
  }
  .market-intro {
    padding: 9px 3px 21px;
  }
  .market-intro h2 {
    font-size: 24px;
  }
  .market-list {
    padding: 0 12px;
  }
  .market-identity {
    gap: 11px;
  }
  .market-row {
    gap: 8px;
  }
}
</style>
