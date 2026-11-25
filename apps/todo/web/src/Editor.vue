<script setup lang="ts">
import type { Item } from '@t-box/todo-contracts'
import {

  localDay,
  occurs,
  shift,
  validate,
} from '@t-box/todo-contracts'
import { AppIcon, Modal, SheetSelect } from '@t-box/ui-kit'

import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import TimeSheetField from '@t-box/ui-kit/TimeSheetField.vue'
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
function addStep(milestone = false) {
  draft.value.steps.push({
    ...(milestone ? { milestone: true } : {}),
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
      <label class="field">名称<FormControl
        v-model="draft.title"
        required
        maxlength="200"
        placeholder="填写事项名称"
      /></label>
      <label v-if="draft.kind === 'task'" class="field">备注
        <FormControl
          v-model="draft.note"
          multiline
          rows="3"
          maxlength="4000"
          placeholder="补充说明（选填）"
        />
      </label>
      <div class="field-pair">
        <label class="field">{{
          draft.kind === "task" || draft.kind === "period"
            ? "计划日期"
            : "开始日期"
        }}<DateSheetField
          v-model="draft.date"
          label="计划日期"
          :clearable="draft.kind === 'task' || draft.kind === 'plan'"
        /></label>
        <label
          v-if="draft.kind === 'list' || draft.kind === 'plan'"
          class="field"
        >结束日期<DateSheetField
          v-model="draft.end"
          label="结束日期"
          clearable
          :min="draft.date || undefined"
        /></label>
        <label
          v-else
          class="field"
        >截止日期<DateSheetField
          v-model="draft.due"
          label="截止日期"
          clearable
        /></label>
      </div>
      <label
        v-if="draft.kind !== 'plan'"
        class="field"
      >计划时间<TimeSheetField
        v-model="draft.time"
        label="计划时间"
        clearable
      /></label>
      <label><FormControl v-model="draft.urgent" type="checkbox" /> 紧急</label>
      <label v-if="draft.kind !== 'plan'"><FormControl v-model="draft.reminder" type="checkbox" />
        到时在应用内提醒</label>
      <template v-if="draft.rule">
        <div class="field-pair">
          <label class="field">每隔<FormControl
            v-model.number="draft.rule.interval"
            type="number"
            min="1"
            max="52"
            required
          /></label>
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
          ><FormControl
            v-model="draft.rule.weekdays"
            type="checkbox"
            :value="i"
          />周{{ d }}</label>
        </div>
        <label v-if="draft.rule.unit === 'month'"><FormControl v-model="draft.rule.lastDay" type="checkbox" />
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
          <FormControl
            v-model="s.title"
            required
            maxlength="200"
            :aria-label="'第 ' + (i + 1) + ' 项名称'"
            :placeholder="s.milestone ? '里程碑名称' : '事项名称'"
          />
          <DateSheetField
            v-if="draft.kind === 'plan'"
            v-model="s.date"
            label="子事项日期"
            clearable
          />
          <FormControl
            v-if="draft.kind === 'plan'"
            v-model="s.stage"
            maxlength="80"
            aria-label="阶段名称"
            placeholder="阶段名称（选填）"
          />
          <label v-if="draft.kind === 'plan'"><FormControl v-model="s.milestone" type="checkbox" />里程碑</label>
          <label v-if="draft.kind === 'plan'"><FormControl v-model="s.urgent" type="checkbox" />紧急</label>
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
        <button
          v-if="draft.kind === 'plan'"
          type="button"
          class="plain"
          @click="addStep(true)"
        >＋ 添加里程碑</button>
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
