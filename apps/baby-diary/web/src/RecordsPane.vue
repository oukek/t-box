<script setup lang="ts">
import type { BabyRecord, BabyRecordKind } from '@t-box/baby-diary-contracts'
import type { RecordPage } from './runtime'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BabyDoodle from './BabyDoodle.vue'
import QuickActionCard from './QuickActionCard.vue'
import RecordCard from './RecordCard.vue'
import RecordEditor from './RecordEditor.vue'
import {
  base,
  canScope,
  errorText,
  invoke,
  manager,
  onPrivateClear,
  refreshBaby,
  selectedId,
  writable,
} from './runtime'

const props = defineProps<{ revision: number }>()
const records = ref<BabyRecord[]>([])
const next = ref<RecordPage['next']>(null)
const loading = ref(false)
const error = ref('')
const filter = ref('')
const query = ref('')
const from = ref('')
const to = ref('')
const trash = ref(false)
const editing = ref<{ kind: BabyRecordKind, value?: BabyRecord }>()
const deleting = ref<BabyRecord>()
const busy = ref(false)
let version = 0
const options = computed(() => [
  { value: '', label: '全部记录' },
  ...(canScope('diary')
    ? [
        { value: 'diary', label: '日记' },
        { value: 'milestone', label: '里程碑' },
      ]
    : []),
  ...(canScope('growth') ? [{ value: 'measurement', label: '测量' }] : []),
])
async function load(more = false) {
  const current = ++version
  loading.value = true
  error.value = ''
  try {
    const page = await invoke<RecordPage>('records_list', {
      ...base(),
      kind: filter.value || null,
      query: query.value || null,
      from: from.value || null,
      to: to.value || null,
      trash: trash.value,
      limit: 40,
      before: more ? next.value : null,
    })
    if (current !== version) {
      return
    }
    records.value = more ? [...records.value, ...page.records] : page.records
    next.value = page.next
  } catch (e) {
    if (current === version) {
      records.value = []
      error.value = errorText(e)
    }
  } finally {
    if (current === version) {
      loading.value = false
    }
  }
}
async function saved() {
  editing.value = undefined
  await refreshBaby()
  await load()
}
async function remove() {
  if (!deleting.value) {
    return
  }
  busy.value = true
  try {
    await invoke('records_delete', {
      ...base(),
      recordId: deleting.value.id,
      revision: deleting.value.revision,
    })
    deleting.value = undefined
    await saved()
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function restore(record: BabyRecord) {
  try {
    await invoke('records_restore', {
      ...base(),
      recordId: record.id,
      revision: record.revision,
    })
    await saved()
  } catch (e) {
    error.value = errorText(e)
  }
}
watch([filter, from, to, trash, selectedId, () => props.revision], () => {
  void load()
})
onMounted(() => {
  void load()
})
const stop = onPrivateClear(() => {
  version++
  records.value = []
  editing.value = undefined
  deleting.value = undefined
})
onBeforeUnmount(() => {
  version++
  stop()
})
</script>

<template>
  <section aria-label="宝宝记录">
    <div v-if="writable" class="quick-record">
      <QuickActionCard
        v-if="canScope('diary')"
        title="写日记"
        hint="珍藏日常"
        @click="editing = { kind: 'diary' }"
      >✎</QuickActionCard><QuickActionCard
        v-if="canScope('growth')"
        title="记测量"
        hint="一点点长大"
        tone="sage"
        @click="editing = { kind: 'measurement' }"
      >↗</QuickActionCard><QuickActionCard
        v-if="canScope('diary')"
        title="里程碑"
        hint="小小的第一次"
        tone="gold"
        @click="editing = { kind: 'milestone' }"
      >☆</QuickActionCard>
    </div>
    <div class="section-heading">
      <h2>{{ trash ? "记录回收站" : "成长时光线" }}</h2>
      <button
        v-if="manager"
        class="text-button muted"
        @click="trash = !trash"
      >
        {{ trash ? "返回记录" : "回收站" }}
      </button>
    </div>
    <form class="record-filters" @submit.prevent="load()">
      <SheetSelect
        v-model="filter"
        label="记录类型"
        :options="options"
      />
      <div class="search-field">
        <input
          v-model="query"
          aria-label="搜索记录"
          placeholder="搜索那些小瞬间"
          maxlength="80"
        ><button class="text-button" type="submit">搜索</button>
      </div>
    </form>
    <details class="date-filters">
      <summary>按日期筛选<span v-if="from || to"> · 已筛选</span></summary>
      <div class="two-columns">
        <label>从<DateField
          v-model="from"
          label="开始日期"
          clearable
        /></label><label>到<DateField
          v-model="to"
          label="结束日期"
          clearable
        /></label>
      </div>
    </details>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <div v-if="!records.length" class="empty-state">
      <BabyDoodle scene="memory" />
      <h3>
        {{
          loading
            ? "正在翻开成长记录…"
            : trash
              ? "回收站是空的"
              : "让今天成为第一篇"
        }}
      </h3>
      <p>
        {{
          trash
            ? "删除的记录可以在这里恢复。"
            : "一张照片、一次测量，或是一个小小的第一次。"
        }}
      </p>
    </div>
    <div v-else class="timeline">
      <div
        v-for="record in records"
        :key="record.id"
        class="timeline-entry"
      >
        <time :datetime="record.date"><b>{{ record.date.slice(5).replace("-", ".") }}</b><small>{{ record.date.slice(0, 4) }}</small></time>
        <div>
          <RecordCard
            :record="record"
            @edit="editing = { kind: record.kind, value: record }"
            @remove="deleting = record"
          /><button
            v-if="trash"
            class="text-button restore-button"
            @click="restore(record)"
          >
            恢复这条记录
          </button>
        </div>
      </div>
    </div>
    <button
      v-if="next"
      class="secondary full load-more"
      :disabled="loading"
      @click="load(true)"
    >
      {{ loading ? "加载中…" : "更早的记忆" }}
    </button>
  </section>
  <RecordEditor
    v-if="editing"
    :kind="editing.kind"
    :value="editing.value"
    @close="editing = undefined"
    @saved="saved"
  />
  <Modal
    :open="!!deleting"
    title="删除这条记录？"
    :busy="busy"
    @close="deleting = undefined"
  ><p>记录会移入回收站，照片和附件一并保留，管理者可以恢复。</p>
    <template #footer><button
      class="secondary"
      :disabled="busy"
      @click="deleting = undefined"
    >
      取消</button><button
      class="danger"
      :disabled="busy"
      @click="remove"
    >
      移入回收站
    </button></template></Modal>
</template>
