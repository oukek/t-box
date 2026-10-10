<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import LedgerCategoriesPage from "./features/LedgerCategoriesPage.vue";
import ProvidersPage from "./features/ProvidersPage.vue";
import WorkflowPage from "./features/WorkflowPage.vue";
import ConfigurationPage from "./features/ConfigurationPage.vue";
import ModelsPage from "./features/ModelsPage.vue";
import BillingPage from "./features/BillingPage.vue";
import PaymentsPage from "./features/PaymentsPage.vue";
import UsersPage from "./features/UsersPage.vue";
import RechargeSettingsPage from "./features/RechargeSettingsPage.vue";
import SupportPage from "./features/SupportPage.vue";
import HolidaysPage from "./features/HolidaysPage.vue";
import ApplicationsPage from "./features/ApplicationsPage.vue";
import { administrator, login, logout, restoreSession } from "./core/session";
import { errorMessage } from "./core/api";
import AdminIcon from "./components/AdminIcon.vue";
import AdminDialog from "./components/AdminDialog.vue";
const pages = {
  configuration: {
    title: "配置中心",
    symbol: "model",
    component: ConfigurationPage,
  },
  workflow: { title: "分析流程", symbol: "chat", component: WorkflowPage },
  "ledger-categories": {
    title: "记账分类",
    symbol: "grid",
    component: LedgerCategoriesPage,
  },
  holidays: { title: "节假日", symbol: "grid", component: HolidaysPage },
  applications: {
    title: "应用发布",
    symbol: "grid",
    component: ApplicationsPage,
  },
  providers: {
    title: "服务商",
    symbol: "connection",
    component: ProvidersPage,
  },
  models: { title: "模型", symbol: "model", component: ModelsPage },
  billing: { title: "用户与余额", symbol: "users", component: BillingPage },
  recharge: {
    title: "充值配置",
    symbol: "model",
    component: RechargeSettingsPage,
  },
  payments: { title: "支付订单", symbol: "model", component: PaymentsPage },
  users: { title: "管理员", symbol: "users", component: UsersPage },
  support: { title: "客服配置", symbol: "chat", component: SupportPage },
};
type Page = keyof typeof pages;
const page = ref<Page>("providers"),
  username = ref(""),
  password = ref(""),
  error = ref(""),
  busy = ref(false),
  loading = ref(true);
const logoutOpen = ref(false);
const current = computed(() => pages[page.value]);
function readHash() {
  const value = location.hash.slice(2);
  page.value = Object.hasOwn(pages, value) ? (value as Page) : "providers";
}
function navigate(value: Page) {
  location.hash = `/${value}`;
  page.value = value;
}
function expired() {
  administrator.value = null;
  error.value = "登录已失效，请重新登录";
}
async function signIn() {
  busy.value = true;
  error.value = "";
  try {
    await login(username.value, password.value);
    password.value = "";
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function signOut() {
  busy.value = true;
  error.value = "";
  try {
    await logout();
    logoutOpen.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  readHash();
  window.addEventListener("hashchange", readHash);
  window.addEventListener("admin-session-expired", expired);
  try {
    await restoreSession();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("hashchange", readHash);
  window.removeEventListener("admin-session-expired", expired);
});
</script>
<template>
  <div v-if="loading" class="loading-screen">正在读取管理会话…</div>
  <main v-else-if="!administrator" class="login-layout">
    <section class="login-intro">
      <a class="brand" href="#/"
        ><span class="brand-icon"><AdminIcon name="grid" :size="21" /></span>T
        BOX <small>CONTROL</small></a
      >
      <div>
        <p class="eyebrow">应用的能力，从这里连接</p>
        <h1>每个模型，<br /><span>各就其位。</span></h1>
        <p>连接服务商，配置模型。<br />为 T Box 的日常对话准备合适的能力。</p>
      </div>
      <span class="login-footer">T BOX / 管理工作台</span>
    </section>
    <section class="login-panel">
      <p class="eyebrow">ADMINISTRATOR</p>
      <h2>登录工作台</h2>
      <p class="muted">使用独立的后台管理员账号继续。</p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <form @submit.prevent="signIn">
        <fieldset :disabled="busy">
          <label
            >账号<input
              v-model="username"
              autocomplete="username"
              required
              maxlength="64"
              autofocus /></label
          ><label
            >密码<input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              maxlength="128" /></label
          ><button class="primary login-button">
            {{ busy ? "正在登录…" : "登录 →" }}
          </button>
        </fieldset>
      </form>
      <p class="login-help">
        首次使用？在项目目录执行
        <code>pnpm admin:init</code>，从本地凭据文件获取初始账号。
      </p>
    </section>
  </main>
  <div v-else class="admin-layout">
    <aside class="sidebar">
      <a class="brand" href="#/providers"
        ><span class="brand-icon"><AdminIcon name="grid" :size="21" /></span
        ><span>T BOX<small>管理工作台</small></span></a
      ><span class="nav-caption">工作空间</span>
      <nav aria-label="后台导航">
        <button
          v-for="(item, key) in pages"
          :key="key"
          :class="{ active: page === key }"
          :aria-current="page === key ? 'page' : undefined"
          @click="navigate(key)"
        >
          <AdminIcon :name="item.symbol" />{{ item.title }}
        </button>
      </nav>
      <div class="sidebar-note">
        <span class="sidebar-note-title">T Box Control</span>
        <p>管理连接，配置应用能力。</p>
      </div>
    </aside>
    <div class="admin-main">
      <header class="topbar">
        <span>工作台 <span class="slash">/</span> {{ current.title }}</span>
        <div>
          <span class="avatar" aria-hidden="true">{{
            administrator.username[0]?.toUpperCase()
          }}</span
          ><span class="topbar-username">{{ administrator.username }}</span
          ><button
            class="icon-button"
            aria-label="退出登录"
            :disabled="busy"
            @click="
              logoutOpen = true;
              error = '';
            "
          >
            <AdminIcon name="logout" :size="17" />
          </button>
        </div>
      </header>
      <main class="page-content">
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <component :is="current.component" :key="page" />
      </main>
    </div>
    <AdminDialog
      :open="logoutOpen"
      title="退出工作台？"
      description="退出后需要重新登录，已保存的配置不会受影响。"
      :busy="busy"
      compact
      @close="logoutOpen = false"
      ><p v-if="error" class="alert" role="alert">{{ error }}</p>
      <template #footer
        ><button :disabled="busy" @click="logoutOpen = false">取消</button
        ><button class="primary" :disabled="busy" @click="signOut">
          {{ busy ? "正在退出…" : "退出登录" }}
        </button></template
      ></AdminDialog
    >
  </div>
</template>
