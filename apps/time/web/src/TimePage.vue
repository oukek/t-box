<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import {
  commonTimezones,
  timeSnapshot,
  validTimezone,
  timerState,
  type AppTimer,
  type TimerAction,
} from "@t-box/time-contracts";
import { identity } from "@t-box/app-shell-sdk";
import { Modal } from "@t-box/ui-kit";
import { AppIcon } from "@t-box/ui-kit";
import { SheetSelect } from "@t-box/ui-kit";
import ReminderSettings from "@t-box/device-reminders/ReminderSettings.vue";
import { syncDeviceReminders } from "@t-box/device-reminders/deviceReminders";
import { timeApi } from "./api";
import { durationLabel } from "./stopwatch";
import TimeConversion from "./TimeConversion.vue";
import StopwatchPanel from "./StopwatchPanel.vue";
import "@t-box/ui-kit/temporal.css";
import "./time.css";
const props = defineProps<{
  tab?: string;
  timezone?: string;
  openRevision?: number;
}>();
const deviceZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  tab = ref("clock"),
  zone = ref(deviceZone),
  now = ref(Date.now()),
  offset = ref(0),
  synced = ref(false),
  error = ref(""),
  busy = ref(false),
  timers = ref<AppTimer[]>([]),
  creating = ref(false),
  label = ref(""),
  hours = ref("0"),
  minutes = ref("5"),
  seconds = ref("0"),
  deleting = ref<AppTimer | null>(null),
  zoneModal = ref(false),
  customZone = ref(""),
  clocks = ref<string[]>([
    ...new Set([deviceZone, "America/New_York", "Europe/London", "Asia/Tokyo"]),
  ]);
let preferenceOwner = "";
const snap = computed(() =>
    timeSnapshot(zone.value, new Date(now.value + offset.value)),
  ),
  liveTimers = computed(() =>
    timers.value.map((t) => ({
      ...t,
      ...timerState(t, now.value + offset.value),
    })),
  ),
  zoneOptions = computed(() =>
    commonTimezones.some((z) => z.value === zone.value)
      ? commonTimezones
      : [{ value: zone.value, label: zone.value }, ...commonTimezones],
  );
let tick: ReturnType<typeof setInterval> | undefined,
  poll: ReturnType<typeof setInterval> | undefined,
  loadId = 0;
watch(
  () => [props.tab, props.timezone, props.openRevision],
  () => {
    tab.value = props.tab ?? "clock";
    zone.value = props.timezone ?? deviceZone;
  },
  { immediate: true },
);
watch(
  () => identity.user?.id,
  (id) => {
    preferenceOwner = id ?? "";
    loadId++;
    timers.value = [];
    synced.value = false;
    clocks.value = [
      ...new Set([
        deviceZone,
        "America/New_York",
        "Europe/London",
        "Asia/Tokyo",
      ]),
    ];
    if (id) {
      try {
        const saved = JSON.parse(
          localStorage.getItem(`tbox.time:${id}:clocks`) || "null",
        );
        if (
          Array.isArray(saved) &&
          saved.length <= 12 &&
          saved.every((z) => {
            try {
              validTimezone(z);
              return true;
            } catch {
              return false;
            }
          })
        )
          clocks.value = [...new Set(saved)];
      } catch {}
      void refresh();
    }
  },
  { immediate: true, flush: "sync" },
);
watch(
  clocks,
  () => {
    if (!preferenceOwner || preferenceOwner !== identity.user?.id) return;
    try {
      localStorage.setItem(
        `tbox.time:${preferenceOwner}:clocks`,
        JSON.stringify(clocks.value),
      );
    } catch {}
  },
  { deep: true },
);
async function refresh() {
  const ticket = ++loadId;
  try {
    const start = Date.now();
    const result = await timeApi.list();
    if (ticket !== loadId) return;
    offset.value = Date.parse(result.data.serverNow) - (start + Date.now()) / 2;
    synced.value = true;
    timers.value = result.data.timers;
    error.value = "";
  } catch (cause) {
    if (ticket === loadId)
      error.value = cause instanceof Error ? cause.message : "时间服务读取失败";
  }
}
function foreground() {
  if (document.visibilityState === "visible") {
    now.value = Date.now();
    void refresh();
  }
}
onMounted(() => {
  void refresh();
  tick = setInterval(() => {
    now.value = Date.now();
  }, 250);
  poll = setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, 15000);
  document.addEventListener("visibilitychange", foreground);
});
onBeforeUnmount(() => {
  loadId++;
  clearInterval(tick);
  clearInterval(poll);
  document.removeEventListener("visibilitychange", foreground);
});
function clockSnap(z: string) {
  return timeSnapshot(z, new Date(now.value + offset.value));
}
function clockName(z: string) {
  return commonTimezones.find((v) => v.value === z)?.label || z;
}
function addZone(value: string) {
  error.value = "";
  try {
    const z = validTimezone(value.trim());
    if (clocks.value.includes(z)) throw new Error("此时区已添加");
    if (clocks.value.length >= 12) throw new Error("最多添加 12 个世界时钟");
    clocks.value.push(z);
    zoneModal.value = false;
    customZone.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "时区无效";
  }
}
function preset(s: number) {
  hours.value = String(Math.floor(s / 3600));
  minutes.value = String(Math.floor(s / 60) % 60);
  seconds.value = String(s % 60);
}
async function create() {
  error.value = "";
  if (
    ![hours.value, minutes.value, seconds.value].every((v) =>
      /^\d{1,3}$/.test(v),
    ) ||
    Number(minutes.value) > 59 ||
    Number(seconds.value) > 59
  ) {
    error.value = "小时、分钟、秒请填写整数；分钟和秒为 0—59";
    return;
  }
  const durationSeconds =
    Number(hours.value) * 3600 +
    Number(minutes.value) * 60 +
    Number(seconds.value);
  if (durationSeconds < 1 || durationSeconds > 604800) {
    error.value = "倒计时时长需为 1 秒至 7 天";
    return;
  }
  busy.value = true;
  try {
    await timeApi.create({
      label: label.value.trim() || "倒计时",
      durationSeconds,
    });
    creating.value = false;
    label.value = "";
    await refresh();
    void syncDeviceReminders(true);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "创建失败";
  } finally {
    busy.value = false;
  }
}
async function control(timer: AppTimer, action: TimerAction) {
  busy.value = true;
  try {
    await timeApi.control(timer, action);
    await refresh();
    void syncDeviceReminders(true);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!deleting.value) return;
  busy.value = true;
  try {
    await timeApi.remove(deleting.value);
    deleting.value = null;
    await refresh();
    void syncDeviceReminders(true);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除失败";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="temporal-page time-page">
    <nav class="temporal-tabs time-tabs" aria-label="时间功能">
      <button
        v-for="item in [
          { id: 'clock', title: '世界时钟' },
          { id: 'timers', title: '倒计时' },
          { id: 'stopwatch', title: '秒表' },
          { id: 'convert', title: '时间换算' },
        ]"
        :key="item.id"
        :aria-pressed="tab === item.id"
        @click="tab = item.id"
      >
        {{ item.title }}
      </button>
    </nav>
    <p v-if="error" class="temporal-error" role="alert">{{ error }}</p>
    <template v-if="tab === 'clock'"
      ><div class="time-now">
        <div class="time-clock-heading">
          <span>此刻</span
          ><SheetSelect
            v-model="zone"
            :options="zoneOptions"
            label="主时钟时区"
          />
        </div>
        <p class="time-digital">{{ snap.time }}</p>
        <p class="time-date">
          {{ snap.date }} · 星期{{
            ["一", "二", "三", "四", "五", "六", "日"][snap.weekday - 1]
          }}
        </p>
        <div class="time-facts">
          <span>第 {{ snap.weekOfYear }} 周</span
          ><span>今年第 {{ snap.dayOfYear }} 天</span
          ><span>UTC{{ snap.offset }}</span>
        </div>
        <small>{{
          synced ? "已与服务器时间校准" : "设备时间 · 尚未校准"
        }}</small>
      </div>
      <div class="time-section-heading">
        <h2>世界时钟</h2>
        <button
          class="temporal-text-button"
          @click="
            zoneModal = true;
            error = '';
          "
        >
          添加城市
        </button>
      </div>
      <div class="time-world-grid">
        <article v-for="z in clocks" :key="z">
          <header>
            <strong>{{ clockName(z) }}</strong
            ><button
              class="icon-button"
              :aria-label="`移除${clockName(z)}时钟`"
              @click="clocks = clocks.filter((v) => v !== z)"
            >
              <AppIcon name="close" :size="15" />
            </button>
          </header>
          <p>{{ clockSnap(z).time }}</p>
          <small>{{ clockSnap(z).date }} · UTC{{ clockSnap(z).offset }}</small>
        </article>
      </div>
      <p class="temporal-note">
        时区自动遵循夏令时。世界时钟保存在此设备，每个账号独立。
      </p></template
    ><template v-else-if="tab === 'timers'"
      ><div class="time-section-heading">
        <div>
          <h2>把时间留给重要的事</h2>
          <p>多个倒计时，暂停后随时继续</p>
        </div>
        <button
          class="temporal-primary"
          @click="
            creating = true;
            error = '';
          "
        >
          <AppIcon name="plus" :size="16" />新建
        </button>
      </div>
      <div class="time-timer-grid">
        <article
          v-for="timer in liveTimers"
          :key="timer.id"
          class="time-timer"
          :class="timer.status"
        >
          <header>
            <strong>{{ timer.label }}</strong
            ><button
              class="icon-button"
              :disabled="busy"
              :aria-label="`删除${timer.label}`"
              @click="deleting = timer"
            >
              <AppIcon name="trash" :size="16" />
            </button>
          </header>
          <p class="time-timer-digits">
            {{ durationLabel(timer.remainingMs) }}
          </p>
          <small
            >{{
              {
                running: "正在计时",
                paused: "已暂停",
                completed: "计时结束",
                cancelled: "已取消",
              }[timer.status]
            }}
            · 原时长 {{ durationLabel(timer.durationSeconds * 1000) }}</small
          >
          <div class="time-timer-actions">
            <button
              v-if="timer.status === 'running'"
              class="temporal-text-button"
              :disabled="busy"
              @click="control(timer, 'pause')"
            >
              暂停</button
            ><button
              v-else-if="timer.status === 'paused'"
              class="temporal-text-button"
              :disabled="busy"
              @click="control(timer, 'resume')"
            >
              继续</button
            ><button
              class="temporal-text-button"
              :disabled="busy"
              @click="control(timer, 'restart')"
            >
              重新开始</button
            ><button
              v-if="['running', 'paused'].includes(timer.status)"
              class="temporal-text-button"
              :disabled="busy"
              @click="control(timer, 'cancel')"
            >
              取消计时
            </button>
          </div>
        </article>
      </div>
      <p v-if="!timers.length" class="temporal-empty">
        专注、休息、烹饪，给每件事一段时间。
      </p>
      <ReminderSettings />
      <p class="temporal-note">
        倒计时保存在账号中，刷新不会重置。网页关闭后不提醒；App
        系统提醒需授权且受系统限制。
      </p></template
    ><StopwatchPanel v-show="tab === 'stopwatch'" /><TimeConversion
      v-show="tab === 'convert'"
    /><Modal
      :open="creating"
      title="新建倒计时"
      :busy="busy"
      @close="creating = false"
      ><form class="temporal-editor" @submit.prevent="create">
        <fieldset :disabled="busy">
          <label class="temporal-field"
            >名称<input
              v-model="label"
              aria-label="倒计时名称"
              maxlength="100"
              placeholder="例如：专注阅读"
          /></label>
          <div class="time-duration-fields">
            <label
              >小时<input
                v-model="hours"
                inputmode="numeric"
                aria-label="倒计时小时"
                maxlength="3" /></label
            ><label
              >分钟<input
                v-model="minutes"
                inputmode="numeric"
                aria-label="倒计时分钟"
                maxlength="2" /></label
            ><label
              >秒<input
                v-model="seconds"
                inputmode="numeric"
                aria-label="倒计时秒"
                maxlength="2"
            /></label>
          </div>
          <div class="time-presets">
            <button
              v-for="s in [60, 300, 600, 1500, 3600]"
              :key="s"
              type="button"
              @click="preset(s)"
            >
              {{ s / 60 }} 分钟
            </button>
          </div>
        </fieldset>
        <p v-if="error" class="temporal-error" role="alert">{{ error }}</p>
        <div class="temporal-actions">
          <button
            type="button"
            class="button button-secondary"
            :disabled="busy"
            @click="creating = false"
          >
            取消</button
          ><button class="button button-primary" :disabled="busy">
            {{ busy ? "创建中…" : "开始计时" }}
          </button>
        </div>
      </form></Modal
    ><Modal
      :open="!!deleting"
      title="删除倒计时"
      :busy="busy"
      @close="deleting = null"
      ><p class="temporal-note">删除“{{ deleting?.label }}”及对应本机提醒？</p>
      <p v-if="error" class="temporal-error" role="alert">{{ error }}</p>
      <div class="temporal-actions">
        <button
          class="button button-secondary"
          :disabled="busy"
          @click="deleting = null"
        >
          取消</button
        ><button class="button button-danger" :disabled="busy" @click="remove">
          确认删除
        </button>
      </div></Modal
    ><Modal :open="zoneModal" title="添加世界时钟" @close="zoneModal = false"
      ><div class="time-zone-picker">
        <button
          v-for="option in commonTimezones"
          :key="option.value"
          :disabled="clocks.includes(option.value)"
          @click="addZone(option.value)"
        >
          {{ option.label }}<small>{{ option.value }}</small>
        </button>
      </div>
      <form class="temporal-inline" @submit.prevent="addZone(customZone)">
        <input
          v-model="customZone"
          aria-label="自定义 IANA 时区"
          placeholder="例如 Pacific/Honolulu"
          maxlength="80"
        /><button class="temporal-text-button">添加</button>
      </form>
      <p v-if="error" class="temporal-error" role="alert">{{ error }}</p></Modal
    >
  </section>
</template>
