<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  commonTimezones,
  timeSnapshot,
  calculateTime,
} from "@t-box/time-contracts";
import { SheetSelect } from "@t-box/ui-kit";
import DateSheetField from "@t-box/ui-kit/DateSheetField.vue";
import TimeSheetField from "@t-box/ui-kit/TimeSheetField.vue";
const deviceZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  error = ref("");
function clockName(z: string) {
  return commonTimezones.find((v) => v.value === z)?.label || z;
}
const kind = ref("convert"),
  source = ref(deviceZone),
  target = ref("UTC"),
  date = ref(timeSnapshot(deviceZone).date),
  time = ref("12:00"),
  endDate = ref(timeSnapshot(deviceZone).date),
  endTime = ref("13:00"),
  timestamp = ref(String(Math.floor(Date.now() / 1000))),
  stampUnit = ref("seconds"),
  amount = ref("1"),
  unit = ref("days"),
  result = ref<Record<string, unknown> | null>(null);
const calculationZones = computed(() =>
  [
    ...new Set([
      ...commonTimezones.map((z) => z.value),
      deviceZone,
      source.value,
      target.value,
    ]),
  ].map((value) => ({ value, label: clockName(value) })),
);
function calculate() {
  error.value = "";
  result.value = null;
  try {
    result.value = calculateTime({
      kind: kind.value,
      source: source.value,
      target: target.value,
      value:
        kind.value === "timestamp"
          ? timestamp.value
          : `${date.value}T${time.value}`,
      end: `${endDate.value}T${endTime.value}`,
      amount: amount.value,
      unit: kind.value === "timestamp" ? stampUnit.value : unit.value,
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "计算失败";
  }
}
watch(
  [
    kind,
    source,
    target,
    date,
    time,
    endDate,
    endTime,
    timestamp,
    stampUnit,
    amount,
    unit,
  ],
  () => {
    result.value = null;
  },
);
</script>
<template>
  <div>
    <p v-if="error" class="temporal-error" role="alert">{{ error }}</p>
    <form class="time-conversion temporal-editor" @submit.prevent="calculate">
      <label class="temporal-field"
        >计算方式<SheetSelect
          v-model="kind"
          label="时间计算方式"
          :options="[
            { value: 'convert', label: '时区转换 / 日期转时间戳' },
            { value: 'timestamp', label: '时间戳转日期' },
            { value: 'difference', label: '计算时间差' },
            { value: 'shift', label: '日期时间加减' },
          ]"
      /></label>
      <div class="temporal-field-grid">
        <label class="temporal-field"
          >{{ kind === "timestamp" ? "参考时区" : "起始时区"
          }}<SheetSelect
            v-model="source"
            :options="calculationZones"
            label="起始时区" /></label
        ><label v-if="kind !== 'shift'" class="temporal-field"
          >{{ kind === "difference" ? "结束时区" : "目标时区"
          }}<SheetSelect
            v-model="target"
            :options="calculationZones"
            label="目标时区"
        /></label>
      </div>
      <div v-if="kind === 'timestamp'" class="temporal-field-grid">
        <label class="temporal-field"
          >Unix 时间戳<input
            v-model="timestamp"
            inputmode="numeric"
            aria-label="Unix 时间戳" /></label
        ><label class="temporal-field"
          >单位<SheetSelect
            v-model="stampUnit"
            label="时间戳单位"
            :options="[
              { value: 'seconds', label: '秒' },
              { value: 'milliseconds', label: '毫秒' },
            ]"
        /></label>
      </div>
      <template v-else
        ><div class="temporal-field-grid">
          <label class="temporal-field"
            >起始日期<DateSheetField
              v-model="date"
              label="计算起始日期" /></label
          ><label class="temporal-field"
            >起始时间<TimeSheetField v-model="time" label="计算起始时间"
          /></label>
        </div>
        <div v-if="kind === 'difference'" class="temporal-field-grid">
          <label class="temporal-field"
            >结束日期<DateSheetField
              v-model="endDate"
              label="计算结束日期" /></label
          ><label class="temporal-field"
            >结束时间<TimeSheetField v-model="endTime" label="计算结束时间"
          /></label>
        </div>
        <div v-if="kind === 'shift'" class="temporal-field-grid">
          <label class="temporal-field"
            >偏移量（负数为减）<input
              v-model="amount"
              inputmode="text"
              aria-label="时间偏移量" /></label
          ><label class="temporal-field"
            >时间单位<SheetSelect
              v-model="unit"
              label="时间偏移单位"
              :options="[
                { value: 'seconds', label: '秒' },
                { value: 'minutes', label: '分钟' },
                { value: 'hours', label: '小时' },
                { value: 'days', label: '日' },
                { value: 'weeks', label: '周' },
                { value: 'months', label: '月' },
                { value: 'years', label: '年' },
              ]"
          /></label></div></template
      ><button class="temporal-primary" type="submit">计算</button>
      <p class="temporal-note">
        时间差按真实经过时间计算；加减月／年时，超出日期取当月最后一天。夏令时不存在或重复的当地时间将提示重新选择。
      </p>
    </form>
    <dl v-if="result" class="time-result temporal-detail" aria-live="polite">
      <template v-if="'local' in result"
        ><div>
          <dt>当地日期时间</dt>
          <dd>{{ result.local }}</dd>
        </div>
        <div>
          <dt>时区 / 偏移</dt>
          <dd>{{ result.timezone }} / UTC{{ result.offset }}</dd>
        </div>
        <div>
          <dt>Unix 时间戳（秒）</dt>
          <dd>{{ result.timestampSeconds }}</dd>
        </div>
        <div>
          <dt>Unix 时间戳（毫秒）</dt>
          <dd>{{ result.timestampMs }}</dd>
        </div>
        <div>
          <dt>UTC</dt>
          <dd>{{ result.instant }}</dd>
        </div></template
      ><template v-else
        ><div
          v-for="(key, title) in {
            days: '天',
            hours: '小时',
            minutes: '分钟',
            seconds: '秒',
            milliseconds: '毫秒',
          }"
          :key="title"
        >
          <dt>{{ key }}</dt>
          <dd>{{ result[title] }}</dd>
        </div>
        <p>{{ result.note }}</p></template
      >
    </dl>
  </div>
</template>
