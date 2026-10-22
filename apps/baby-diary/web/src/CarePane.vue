<script setup lang="ts">
import type { CareKind, CareRecord } from '@t-box/baby-diary-contracts/care'
import { careInput } from '@t-box/baby-diary-contracts/care'
import { careDays, careDuration, careTitle } from '@t-box/baby-diary-core'
import { dayjs } from '@t-box/dayjs'
import { AppIcon, Modal, SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import CareEditor from './CareEditor.vue'
import CareGlyph from './CareGlyph.vue'
import CareStatistics from './CareStatistics.vue'
import QuickActionCard from './QuickActionCard.vue'
import { baby, canEdit, errorText, onPrivateClear, writable } from './runtime'
import { useCare } from './useCare'

const props = defineProps<{ revision: number, statistics?: boolean }>()
const selected = ref(dayjs().tz(baby.value!.timezone).format('YYYY-MM-DD'))
const length = ref('7')
const range = () => props.statistics
  ? { from: dayjs.utc(selected.value).subtract(Number(length.value) - 1, 'day').format('YYYY-MM-DD'), to: selected.value }
  : { from: selected.value, to: selected.value }
const store = useCare(() => props.revision, range)
watch(() => store.today(), (value, old) => {
  if (selected.value === old) {
    selected.value = value
  }
})
const editing = ref<{ kind: CareKind, value?: CareRecord }>()
const deleting = ref<CareRecord>()
const undone = ref<string>()
const actionError = ref('')
const busy = ref(false)
const from = computed(() => range().from)
const to = computed(() => range().to)
const days = computed(() => careDays(store.records.value, from.value, to.value, store.profile.timezone, store.now.value))
const total = computed(() => days.value[0]!)
const complete = computed(() => store.cached.value || (store.fullPage.value?.days[0]?.date === from.value && store.fullPage.value?.days.at(-1)?.date === to.value))
const timeline = computed(() => store.records.value.filter((row) => !row.deletedAt && dayjs(row.occurredAt).tz(store.profile.timezone).format('YYYY-MM-DD') === selected.value))
const deleted = computed(() => store.records.value.find((row) => row.id === undone.value && row.deletedAt))
const lastFeed = computed(() => store.records.value.find((row) => !row.deletedAt && row.kind === 'feeding'))
const lastDiaper = computed(() => store.records.value.find((row) => !row.deletedAt && row.kind === 'diaper'))
const failure = computed(() => actionError.value || store.error.value)
const elapsed = (at: string) => careDuration(store.now.value - Date.parse(at))
const time = (at: string) => dayjs(at).tz(store.profile.timezone).format('HH:mm')
const dateTime = (at: string) => dayjs(at).tz(store.profile.timezone).format('MM-DD HH:mm')
const clock = (at: string) => {
  const seconds = Math.max(0, Math.floor((store.now.value - Date.parse(at)) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, '0')).join(':')
}
function activeText(row: CareRecord) {
  if (row.kind !== 'feeding') {
    return clock(row.occurredAt)
  }
  const current = row.parts.find((part) => part.kind === 'nursing' && !part.endedAt)
  return current?.kind === 'nursing' ? `${current.side === 'left' ? '左' : '右'}侧 · ${clock(current.startedAt)}` : careTitle(row, store.now.value)
}
async function timer(row: CareRecord, action: 'end' | 'pause' | 'left' | 'right') {
  busy.value = true
  actionError.value = ''
  try {
    const input = careInput(row)
    const now = new Date().toISOString()
    if (input.kind === 'feeding') {
      input.parts = input.parts.map((part) => part.kind === 'nursing' && !part.endedAt ? { ...part, endedAt: now } : part)
      if (action === 'left' || action === 'right') {
        input.parts.push({ kind: 'nursing', side: action, startedAt: now, endedAt: null })
      }
    }
    input.state = action === 'end' ? 'completed' : action === 'pause' ? 'paused' : 'running'
    input.endedAt = action === 'end' ? now : null
    await store.submit(input, row)
  } catch (cause) {
    actionError.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!deleting.value) {
    return
  }
  busy.value = true
  actionError.value = ''
  try {
    const row = deleting.value
    await store.remove(row)
    undone.value = row.id
    deleting.value = undefined
  } catch (cause) {
    actionError.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
async function undo() {
  if (!deleted.value) {
    return
  }
  try {
    await store.remove(deleted.value, true)
    undone.value = undefined
  } catch (cause) {
    actionError.value = errorText(cause)
  }
}
const stop = onPrivateClear(() => {
  editing.value = undefined
  deleting.value = undefined
})
onBeforeUnmount(stop)
</script>

<template>
  <section class="care-pane">
    <div
      v-if="!store.online.value || store.snapshot.value.pending.length"
      class="care-sync-status"
      role="status"
    >
      <AppIcon :name="store.online.value ? 'clock' : 'connection'" :size="14" />
      <span>{{ !store.online.value ? '离线中，记录先保存在本机' : store.syncing.value ? '正在同步照护记录…' : '有待同步的本机记录' }}<template v-if="store.snapshot.value.pending.length"> · {{ store.snapshot.value.pending.length }} 项</template></span>
      <button
        v-if="store.online.value"
        class="text-button"
        :disabled="store.syncing.value"
        @click="store.retry"
      >同步</button>
    </div>
    <p
      v-if="failure"
      class="error"
      role="alert"
    >{{ failure }} <button class="text-button" @click="store.retry">重试</button></p>
    <div
      v-for="command in store.snapshot.value.pending.filter((item) => item.error)"
      :key="command.key"
      class="care-conflict"
    >
      <p>{{ command.error }}。本机内容已保留，请核对云端记录。</p>
      <button
        class="text-button danger-text"
        :disabled="store.syncing.value"
        @click="store.discard(command)"
      >丢弃此记录的本机修改</button>
    </div>
    <template v-if="statistics">
      <div class="section-heading care-statistics-heading"><h2>照护统计</h2><SheetSelect
        v-model="length"
        label="统计范围"
        :options="[{ value: '7', label: '最近 7 天' }, { value: '30', label: '最近 30 天' }]"
      /></div>
      <p class="subtle care-range">{{ from }} 至 {{ to }} · {{ store.profile.timezone }}</p>
      <CareStatistics
        :days="days"
        :complete="complete"
        :pending="store.snapshot.value.pending.length"
      />
    </template>
    <template v-else>
      <div class="care-recent">
        <div><span>最近喂养</span><strong>{{ lastFeed ? `${elapsed(lastFeed.occurredAt)}前` : '暂无记录' }}</strong><small>{{ lastFeed ? `${dateTime(lastFeed.occurredAt)} · ${lastFeed.authorName}` : '记录后家人都能及时看到' }}</small></div>
        <div><span>最近尿布</span><strong>{{ lastDiaper ? `${elapsed(lastDiaper.occurredAt)}前` : '暂无记录' }}</strong><small>{{ lastDiaper ? `${careTitle(lastDiaper)} · ${lastDiaper.authorName}` : '支持尿尿、便便和更换' }}</small></div>
      </div>
      <article
        v-for="row in store.active.value"
        :key="row.id"
        class="care-active"
        :class="`care-active-${row.kind}`"
      >
        <div class="care-active-heading"><CareGlyph :kind="row.kind" /><div><span>{{ row.kind === 'sleep' ? '正在睡眠' : row.state === 'paused' ? '亲喂已暂停' : '正在亲喂' }}<small v-if="store.pendingIds.value.has(row.id)"> · 待同步</small></span><strong>{{ activeText(row) }}</strong><small>{{ row.authorName }}开始记录 · {{ dateTime(row.occurredAt) }}</small></div></div>
        <div v-if="writable" class="care-timer-actions">
          <template v-if="row.kind === 'feeding'"><button
            v-if="row.state === 'running'"
            class="secondary small"
            :disabled="busy"
            @click="timer(row, 'pause')"
          >暂停</button><button
            class="secondary small"
            :disabled="busy"
            @click="timer(row, 'left')"
          >左侧</button><button
            class="secondary small"
            :disabled="busy"
            @click="timer(row, 'right')"
          >右侧</button></template>
          <button
            class="primary small"
            :disabled="busy"
            @click="timer(row, 'end')"
          >{{ row.kind === 'sleep' ? '醒来了' : '结束喂养' }}</button>
          <button
            class="text-button"
            :disabled="busy"
            @click="editing = { kind: row.kind, value: row }"
          >修正</button>
        </div>
      </article>
      <div v-if="writable" class="quick-record">
        <QuickActionCard
          v-for="item in ([{ kind: 'feeding', label: '喂奶', hint: '瓶喂 / 亲喂', tone: 'sage' }, { kind: 'sleep', label: '睡眠', hint: '开始 / 补记', tone: 'sky' }, { kind: 'diaper', label: '尿布', hint: '尿尿 / 便便', tone: 'gold' }] as const)"
          :key="item.kind"
          :title="item.label"
          :hint="item.hint"
          :tone="item.tone"
          :disabled="!store.ready.value"
          @click="editing = { kind: item.kind }"
        ><CareGlyph :kind="item.kind" /></QuickActionCard>
      </div>
      <div class="section-heading care-timeline-heading"><h2>{{ selected === store.today() ? '今天' : selected.slice(5).replace('-', '月') + '日' }}的照护</h2><DateField
        v-model="selected"
        label="查看日期"
        :max="store.today()"
        compact
      /></div>
      <div class="care-daily-strip"><span>喂养 <b>{{ complete ? total.feedings : '—' }}</b> 次</span><span>瓶喂 <b>{{ complete ? total.bottleMl : '—' }}</b> mL</span><span>睡眠 <b>{{ complete ? careDuration(total.sleepMs) : '—' }}</b></span><span>尿布 <b>{{ complete ? total.changes : '—' }}</b> 次</span></div>
      <p v-if="!complete && !store.loading.value" class="subtle">本机尚无此日期的完整云端缓存。{{ !store.online.value ? '联网后可补全记录与统计。' : '' }}</p>
      <div
        v-if="deleted"
        class="care-undo"
        role="status"
      ><span>记录已移入回收状态</span><button class="text-button" @click="undo">撤销删除</button></div>
      <div class="care-timeline">
        <article
          v-for="row in timeline"
          :key="row.id"
          class="care-event"
          :class="{ 'care-event-pending': store.pendingIds.value.has(row.id) }"
        >
          <time :datetime="row.occurredAt">{{ time(row.occurredAt) }}</time><div class="care-event-mark"><CareGlyph :kind="row.kind" /></div>
          <div class="care-event-content"><strong>{{ careTitle(row, store.now.value) }}</strong><p v-if="row.note">{{ row.note }}</p><small>{{ row.authorName }}<template v-if="row.state !== 'completed'"> · {{ row.state === 'paused' ? '已暂停' : '进行中' }}</template><template v-if="store.pendingIds.value.has(row.id)"> · 待同步</template><template v-if="row.updatedAt !== row.createdAt"> · 已修改</template></small></div>
          <div v-if="canEdit(row.author) || (writable && row.state !== 'completed')" class="care-event-actions"><button
            class="round-button"
            aria-label="编辑照护记录"
            @click="editing = { kind: row.kind, value: row }"
          ><AppIcon name="edit" :size="15" /></button><button
            v-if="canEdit(row.author) && !store.pendingIds.value.has(row.id)"
            class="round-button"
            aria-label="删除照护记录"
            @click="deleting = row"
          ><AppIcon name="trash" :size="15" /></button></div>
        </article>
      </div>
      <div v-if="!timeline.length" class="care-empty"><CareGlyph kind="feeding" /><p>{{ store.loading.value ? '正在同步照护记录…' : '还没有这一天的照护记录' }}</p><small>{{ writable ? '从上面的喂奶、睡眠或尿布开始，也可以补记。' : '家人记录后，会在这里显示。' }}</small></div>
      <p class="footnote">按 {{ store.profile.timezone }} 统计。瓶喂量不包含亲喂；未记录不代表没有发生。{{ store.snapshot.value.pending.length ? ' 当前包含尚待云端确认的草稿。' : '' }}</p>
    </template>
  </section>
  <CareEditor
    v-if="editing"
    :kind="editing.kind"
    :value="editing.value"
    :save="store.submit"
    @close="editing = undefined"
  />
  <Modal
    :open="!!deleting"
    title="删除这条照护记录？"
    :busy="busy"
    @close="deleting = undefined"
  >
    <p>删除后会重新计算统计，修改历史仍会保留。删除后也可以点击撤销恢复。</p><p v-if="actionError" class="error">{{ actionError }}</p>
    <template #footer><button
      class="secondary"
      :disabled="busy"
      @click="deleting = undefined"
    >取消</button><button
      class="danger"
      :disabled="busy"
      @click="remove"
    >删除记录</button></template>
  </Modal>
</template>
