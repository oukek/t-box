<script setup lang="ts">
import type { Item } from '@t-box/todo-contracts'
import {

  localDay,
  occurs,
  shift,
  validate,
} from '@t-box/todo-contracts'
import { AppIcon, Modal, SheetSelect } from '@t-box/ui-kit'
import { computed, ref } from 'vue'

const props = defineProps<{ value: Item, busy: boolean, error: string }>()
const emit = defineEmits<{ close: [], save: [item: Item] }>()
const draft = ref<Item>(JSON.parse(JSON.stringify(props.value)))
const message = ref('')
const units = [
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
]
const days = ['日', '一', '二', '三', '四', '五', '六']
const preview = computed(() => {
  const item = draft.value
  if (!item.rule || !item.date || item.paused || !item.rule.interval) {
    return []
  }
  const start = item.date > localDay() ? item.date : localDay()
  const result: string[] = []
  for (let i = 0; i < 5000 && result.length < 3; i++) {
    const d = shift(start, i)
    if (item.end && d > item.end) {
      break
    }
    if (occurs(item, d)) {
      result.push(d)
    }
  }
  return result
})
function submit() {
  try {
    const item = JSON.parse(JSON.stringify(draft.value)) as Item
    item.title = item.title.trim()
    validate(item)
    emit('save', item)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}
function addStep() {
  draft.value.steps.push({
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    title: '',
    date: '',
    done: '',
  })
}
function move(i: number, n: number) {
  const steps = draft.value.steps
  const step = steps.splice(i, 1)[0]
  if (step) {
    steps.splice(i + n, 0, step)
  }
}
</script>

<template>
  <Modal
    :open="true"
    :busy="busy"
    :title="
      value.title
        ? '编辑'
          + { task: '待办', plan: '计划', list: '循环清单', period: '本期安排' }[
            value.kind
          ]
        : '新建'
          + { task: '待办', plan: '计划', list: '循环清单', period: '本期安排' }[
            value.kind
          ]
    "
    :class="{ 'long-editor': draft.kind !== 'task' }"
    @close="emit('close')"
  >
    <form
      id="todo-editor"
      class="edit-body"
      @submit.prevent="submit"
    >
      <label class="field">名称<input
        v-model="draft.title"
        required
        maxlength="200"
        placeholder="填写事项名称"
      ></label>
      <div class="field-pair">
        <label class="field">{{
          draft.kind === "task" || draft.kind === "period"
            ? "计划日期"
            : "开始日期"
        }}<input
          v-model="draft.date"
          type="date"
          :required="draft.kind === 'list' || draft.kind === 'period'"
        ></label>
        <label
          v-if="draft.kind === 'list' || draft.kind === 'plan'"
          class="field"
        >结束日期<input
          v-model="draft.end"
          type="date"
          :min="draft.date"
        ></label>
        <label
          v-else
          class="field"
        >截止日期<input
          v-model="draft.due"
          type="date"
        ></label>
      </div>
      <label
        v-if="draft.kind !== 'plan'"
        class="field"
      >计划时间<input
        v-model="draft.time"
        type="time"
      ></label>
      <label><input v-model="draft.urgent" type="checkbox"> 紧急</label>
      <label v-if="draft.kind !== 'plan'"><input v-model="draft.reminder" type="checkbox">
        到时在应用内提醒</label>
      <template v-if="draft.rule">
        <div class="field-pair">
          <label class="field">每隔<input
            v-model.number="draft.rule.interval"
            type="number"
            min="1"
            max="52"
            required
          ></label>
          <div class="field">
            重复单位<SheetSelect
              v-model="draft.rule.unit"
              :options="units"
              label="重复单位"
              desktop-modal
            />
          </div>
        </div>
        <div v-if="draft.rule.unit === 'week'" class="days">
          <label
            v-for="(d, i) in days"
            :key="d"
          ><input
            v-model="draft.rule.weekdays"
            type="checkbox"
            :value="i"
          >周{{ d }}</label>
        </div>
        <label v-if="draft.rule.unit === 'month'"><input v-model="draft.rule.lastDay" type="checkbox">
          每月最后一天</label>
        <p class="cap">接下来：{{ preview.join("、") || "没有安排" }}</p>
      </template>
      <template v-if="draft.kind === 'list' || draft.kind === 'plan'">
        <h3>{{ draft.kind === "list" ? "检查项" : "子事项" }}</h3>
        <div
          v-for="(s, i) in draft.steps"
          :key="s.id"
          class="step-edit"
        >
          <input
            v-model="s.title"
            required
            maxlength="200"
            :aria-label="'第 ' + (i + 1) + ' 项名称'"
            placeholder="事项名称"
          >
          <input
            v-if="draft.kind === 'plan'"
            v-model="s.date"
            type="date"
            aria-label="子事项日期"
          >
          <input
            v-if="draft.kind === 'plan'"
            v-model="s.stage"
            maxlength="80"
            aria-label="阶段名称"
            placeholder="阶段名称（选填）"
          >
          <label v-if="draft.kind === 'plan'"><input v-model="s.urgent" type="checkbox">紧急</label>
          <div>
            <button
              type="button"
              :disabled="i === 0"
              @click="move(i, -1)"
            >
              上移</button><button
              type="button"
              :disabled="i + 1 === draft.steps.length"
              @click="move(i, 1)"
            >
              下移</button><button type="button" @click="draft.steps.splice(i, 1)">
              移除
            </button>
          </div>
        </div>
        <button
          type="button"
          class="plain"
          @click="addStep()"
        >
          <AppIcon name="plus" :size="14" /> 添加一项
        </button>
      </template>
      <p v-if="message || error" role="alert">{{ message || error }}</p>
    </form>
    <template #footer><button class="plain" @click="emit('close')">取消</button><button
      class="primary"
      type="submit"
      form="todo-editor"
      :disabled="busy"
    >
      {{ busy ? "保存中…" : "保存" }}
    </button></template>
  </Modal>
</template>
