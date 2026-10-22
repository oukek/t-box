<script setup lang="ts">
import type { BabyProfile } from '@t-box/baby-diary-contracts'
import { babyAge } from '@t-box/baby-diary-core'
import { AppIcon, BottomSheet, Modal, SheetSelect } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BabyDoodle from './BabyDoodle.vue'
import BabyEditor from './BabyEditor.vue'
import { careNavigationOptions } from './careNavigation'
import CarePane from './CarePane.vue'
import CreativePane from './CreativePane.vue'
import GrowthPane from './GrowthPane.vue'
import RecordsPane from './RecordsPane.vue'
import {
  babies,
  baby,
  base,
  clearImages,
  errorText,
  host,
  invoke,
  loadBabies,
  manager,
  onPrivateClear,
  refreshBaby,
  runtime,
  selectedId,
  today,
} from './runtime'
import SharingPanel from './SharingPanel.vue'
import { useBabyTheme } from './useBabyTheme'
import { useCareNavigation } from './useCareNavigation'

useBabyTheme(() => baby.value)
const tab = ref('records')
const careNavigation = useCareNavigation(() => baby.value)
const hasCare = computed(() => runtime.careAvailable && !!baby.value?.scopes.includes('care'))
const growthView = ref('records')
function navigateTab(value: string) {
  if (value === 'growth') {
    tab.value = 'records'
    growthView.value = 'chart'
  } else {
    tab.value = value
  }
}
const revision = ref(0)
const permissionRevision = ref(0)
const error = ref('')
const loading = ref(true)
const profileEditor = ref<{ value?: BabyProfile }>()
const settings = ref(false)
const sharing = ref(false)
const joining = ref(false)
const busy = ref(false)
const token = ref(runtime.params.invite || '')
const displayName = ref(runtime.nickname)
const confirm = ref<'archive' | 'leave'>()
const tabs = computed(() =>
  [
    {
      id: 'records',
      title: '成长',
      icon: 'edit',
      visible: baby.value?.scopes.some((x) => x === 'diary' || x === 'growth'),
    },
    {
      id: 'creative',
      title: '创意',
      icon: 'image',
      visible: baby.value?.scopes.includes('creative'),
    },
    {
      id: 'care',
      title: '照护',
      icon: 'clock',
      visible: hasCare.value && (careNavigation.visible.value || ['care', 'statistics'].includes(tab.value) || !baby.value?.scopes.some((scope) => scope !== 'care')),
    },
  ].filter((row) => row.visible),
)
let stopEvents: (() => void) | undefined
let subscribeVersion = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadBabies()
    if (
      runtime.params.babyId &&
      babies.value.some((row) => row.id === runtime.params.babyId)
    ) {
      selectedId.value = runtime.params.babyId
    }
    if (runtime.params.tab) {
      navigateTab(runtime.params.tab)
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
watch(tabs, (values) => {
  const active = tab.value === 'statistics' ? 'care' : tab.value
  if (!values.some((row) => row.id === active)) {
    tab.value = values[0]?.id || 'records'
  }
})
watch(
  () =>
    baby.value
      ? [
          baby.value.id,
          baby.value.role,
          baby.value.scopes.join(','),
          baby.value.allowExport,
          baby.value.archived,
        ].join('|')
      : '',
  (value, old) => {
    if (!old || value.split('|')[0] !== old.split('|')[0] || value === old) {
      return
    }
    clearImages()
    permissionRevision.value++
    profileEditor.value = undefined
    sharing.value = false
    settings.value = false
  },
)
watch(selectedId, async (id, old) => {
  tab.value = 'records'
  growthView.value = 'records'
  if (runtime.params.tab && (!old || runtime.params.babyId === id)) {
    navigateTab(runtime.params.tab)
  }
  stopEvents?.()
  stopEvents = undefined
  clearTimeout(refreshTimer)
  clearImages()
  const version = ++subscribeVersion
  if (!id) {
    return
  }
  try {
    const stop = await host().events.subscribe(
      'babies',
      { babyId: id },
      () => {
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          void refreshBaby()
            .then(() => {
              revision.value++
            })
            .catch(() => {
              clearImages()
              babies.value = []
              selectedId.value = ''
              void load()
            })
        }, 300)
      },
      {
        onError: (failure) => {
          if (failure.status === 403 || failure.status === 404) {
            clearImages()
            babies.value = []
            selectedId.value = ''
            void load()
          }
        },
      },
    )
    if (version !== subscribeVersion) {
      stop()
    } else {
      stopEvents = stop
    }
  } catch {
    /* Ordinary navigation/reload also rechecks membership when events are temporarily offline. */
  }
})
async function saved(value: BabyProfile) {
  babies.value = babies.value.some((row) => row.id === value.id)
    ? babies.value.map((row) => row.id === value.id ? value : row)
    : [...babies.value, value]
  selectedId.value = value.id
  profileEditor.value = undefined
  try {
    await loadBabies()
  } catch (cause) {
    error.value = errorText(cause)
  }
  revision.value++
}
async function join() {
  busy.value = true
  error.value = ''
  try {
    const value = await invoke<BabyProfile>('invites_accept', {
      token: token.value.trim(),
      displayName: displayName.value,
    })
    joining.value = false
    token.value = ''
    await saved(value)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function execute() {
  if (!baby.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (confirm.value === 'archive') {
      await invoke('babies_archive', {
        ...base(),
        revision: baby.value.revision,
        archived: !baby.value.archived,
      })
    } else {
      await invoke('members_remove', { ...base(), subject: runtime.subject })
    }
    confirm.value = undefined
    settings.value = false
    await load()
    revision.value++
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
watch(
  () => runtime.params,
  async (params) => {
    if (params.invite) {
      token.value = params.invite
      joining.value = true
    }
    if (params.babyId && babies.value.some((row) => row.id === params.babyId)) {
      selectedId.value = params.babyId
    }
    if (params.tab) {
      navigateTab(params.tab)
    }
  },
)
const stopClear = onPrivateClear(() => {
  stopEvents?.()
  clearTimeout(refreshTimer)
  profileEditor.value = undefined
  settings.value = false
  sharing.value = false
  joining.value = false
  token.value = ''
})
onMounted(() => {
  void load()
  if (token.value) {
    joining.value = true
  }
})
onBeforeUnmount(() => {
  subscribeVersion++
  stopEvents?.()
  clearTimeout(refreshTimer)
  clearImages()
  stopClear()
})
</script>

<template>
  <main class="baby-app">
    <header class="app-header">
      <button
        class="round-button"
        aria-label="返回 OS"
        @click="host().navigation.back()"
      >
        <AppIcon name="left" :size="21" />
      </button>
      <h1>宝宝日记</h1>
      <div class="inline-actions">
        <button
          class="round-button"
          aria-label="加入宝宝档案"
          title="加入档案"
          @click="
            error = '';
            joining = true;
          "
        >
          <AppIcon name="link" :size="19" /></button><button
          class="round-button"
          aria-label="创建宝宝档案"
          title="创建档案"
          @click="profileEditor = {}"
        >
          <AppIcon name="plus" :size="20" />
        </button>
      </div>
    </header>
    <p
      v-if="error && !joining && !confirm"
      class="error"
      role="alert"
    >
      {{ error }} <button class="text-button" @click="load">重试</button>
    </p>
    <template v-if="baby">
      <section class="baby-heading">
        <div class="baby-monogram" aria-hidden="true">
          <BabyDoodle scene="avatar" />
          <span class="baby-initial">{{ baby.name.slice(0, 1) }}</span>
        </div>
        <div class="baby-identity">
          <SheetSelect
            v-model="selectedId"
            label="切换宝宝"
            :options="
              babies.map((row) => ({
                value: row.id,
                label: `${row.name}${row.archived ? ' · 已归档' : ''}`,
              }))
            "
          />
          <p>
            {{ babyAge(baby.birthDate, today())
            }}<span v-if="baby.archived"> · 已归档，只读</span><span v-else-if="baby.role === 'viewer'"> · 查看者</span>
          </p>
        </div>
        <button
          class="round-button"
          aria-label="宝宝档案设置"
          @click="settings = true"
        >
          <AppIcon name="settings" :size="20" />
        </button>
      </section>
      <p v-if="!runtime.careAvailable" class="care-upgrade-note">喂养、睡眠和尿布记录已加入新版本。<button class="text-button" @click="host().updates.openMarket()">更新宝宝日记</button></p>
      <nav class="app-tabs" aria-label="宝宝日记功能">
        <button
          v-for="item in tabs"
          :key="item.id"
          :class="{ selected: (tab === 'statistics' ? 'care' : tab) === item.id }"
          :aria-current="(tab === 'statistics' ? 'care' : tab) === item.id ? 'page' : undefined"
          @click="tab = item.id"
        >
          {{ item.title }}
        </button>
      </nav>
      <div class="app-content">
        <div
          v-if="runtime.careAvailable && baby.scopes.includes('care')"
          v-show="tab === 'care' || tab === 'statistics'"
        >
          <div class="care-segments care-view-tabs" aria-label="照护内容">
            <button :class="{ selected: tab === 'care' }" @click="tab = 'care'">日常记录</button>
            <button :class="{ selected: tab === 'statistics' }" @click="tab = 'statistics'">照护统计</button>
          </div>
          <CarePane
            :key="`${baby.id}-${permissionRevision}-care`"
            :revision="revision"
            :statistics="tab === 'statistics'"
          />
        </div>
        <div v-if="tab === 'records' && baby.scopes.includes('growth')" class="care-segments growth-subtabs"><button :class="{ selected: growthView === 'records' }" @click="growthView = 'records'">成长记录</button><button :class="{ selected: growthView === 'chart' }" @click="growthView = 'chart'">测量趋势</button></div>
        <RecordsPane
          v-if="tab === 'records' && (growthView === 'records' || !baby.scopes.includes('growth'))"
          :key="`${baby.id}-${permissionRevision}-records`"
          :revision="revision"
        /><GrowthPane
          v-else-if="tab === 'records' && growthView === 'chart' && baby.scopes.includes('growth')"
          :key="`${baby.id}-${permissionRevision}-growth`"
          :revision="revision"
        /><CreativePane
          v-else-if="tab === 'creative'"
          :key="`${baby.id}-${permissionRevision}-creative`"
          :revision="revision"
        />
      </div>
    </template>
    <div v-else class="first-baby">
      <BabyDoodle scene="welcome" />
      <h2>{{ loading ? "正在打开成长手账…" : "留住每个小小的瞬间" }}</h2>
      <p>身高、体重、第一次微笑，<br>还有每天悄悄变化的模样。</p>
      <button
        v-if="!loading"
        class="primary"
        @click="profileEditor = {}"
      >
        创建宝宝档案</button><button
        v-if="!loading"
        class="text-button"
        @click="
          error = '';
          joining = true;
        "
      >
        我有家人的邀请码
      </button>
    </div>
    <p v-if="!runtime.active" class="error">
      账号或应用状态已变化，请返回 OS 后重新打开。
    </p>
  </main>
  <BabyEditor
    v-if="profileEditor"
    :value="profileEditor.value"
    @close="profileEditor = undefined"
    @saved="saved"
  />
  <BottomSheet
    :open="settings"
    title="宝宝档案"
    @close="settings = false"
  ><div v-if="baby" class="form-stack">
    <div class="profile-summary">
      <strong>{{ baby.name }}</strong><small>{{
        baby.birthDate ? `出生于 ${baby.birthDate}` : "尚未设置出生日期"
      }}
        · {{ baby.timezone }}</small>
    </div>
    <section v-if="hasCare" class="profile-care-settings">
      <div class="profile-care-heading"><AppIcon name="clock" :size="17" /><h3>日常照护</h3></div>
      <p class="subtle">喂养、睡眠、尿布与历史统计，需要时随时打开。</p>
      <div class="profile-care-links">
        <button class="secondary small" @click="settings = false; tab = 'care'">打开照护记录<AppIcon name="right" :size="14" /></button>
        <button class="text-button" @click="settings = false; tab = 'statistics'">查看统计</button>
      </div>
      <label class="profile-care-choice">导航中的照护入口<SheetSelect
        :model-value="careNavigation.mode.value"
        label="照护入口"
        :options="careNavigationOptions"
        @update:model-value="careNavigation.setMode"
      /></label>
      <p class="subtle">只调整你在本机查看此宝宝时的入口，不影响家人的习惯、记录或权限。</p>
      <p
        v-if="careNavigation.error.value"
        class="error"
        role="alert"
      >{{ careNavigation.error.value }}</p>
    </section>
    <button
      v-if="manager && !baby.archived"
      class="menu-row"
      @click="
        settings = false;
        profileEditor = { value: baby };
      "
    >
      <span>编辑宝宝资料</span><span>›</span></button><button
      v-if="manager"
      class="menu-row"
      @click="
        settings = false;
        sharing = true;
      "
    >
      <span>成员与共享权限</span><span>›</span></button><button
      v-if="baby.role === 'owner'"
      class="menu-row"
      @click="
        error = '';
        confirm = 'archive';
      "
    >
      <span>{{ baby.archived ? "取消归档" : "归档宝宝档案" }}</span><span>›</span></button><button
      v-else
      class="menu-row danger-text"
      @click="
        error = '';
        confirm = 'leave';
      "
    >
      <span>退出此宝宝档案</span><span>›</span>
    </button>
    <p class="subtle">
      照片与附件私有保存。云端记录需要联网，创意影像的对齐和播放在设备上完成。
    </p>
  </div></BottomSheet>
  <SharingPanel
    v-if="sharing"
    @close="sharing = false"
    @changed="refreshBaby().then(() => revision++)"
  />
  <Modal
    :open="joining"
    title="加入宝宝档案"
    :busy="busy"
    @close="joining = false"
  ><form
     id="baby-join-form"
     class="form-stack"
     @submit.prevent="join"
   >
     <label>家人发来的邀请码<textarea
       v-model="token"
       rows="3"
       maxlength="128"
       required
       placeholder="粘贴邀请码"
     /></label><label>你在档案中的称呼<input
       v-model="displayName"
       maxlength="40"
       required
       placeholder="例如：外婆"
     ></label>
     <p class="subtle">
       加入后，此宝宝将显示在你的档案列表里。权限由邀请人设定。
     </p>
     <p
       v-if="error"
       class="error"
       role="alert"
     >{{ error }}</p>
   </form>
    <template #footer><button
      class="primary"
      form="baby-join-form"
      :disabled="busy"
    >
      {{ busy ? "加入中…" : "加入档案" }}
    </button></template></Modal>
  <Modal
    :open="!!confirm"
    :title="
      confirm === 'archive'
        ? baby?.archived
          ? '取消归档？'
          : '归档宝宝档案？'
        : '退出此档案？'
    "
    :busy="busy"
    @close="confirm = undefined"
  ><p>
     {{
       confirm === "archive"
         ? "归档保留所有记录，成员仍可查看，但不能继续写入。所有者可以取消归档。"
         : "退出后将不能查看此宝宝的记录，需要家人重新邀请才能加入。已写入的记录会保留。"
     }}
   </p>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <template #footer><button
      class="secondary"
      :disabled="busy"
      @click="confirm = undefined"
    >
      取消</button><button
      class="danger"
      :disabled="busy"
      @click="execute"
    >
      确认
    </button></template></Modal>
</template>
