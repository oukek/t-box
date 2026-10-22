<script setup lang="ts">
import type { CareInput, CareKind, CareRecord, FeedingPart } from '@t-box/baby-diary-contracts/care'
import { careInput, parseCare } from '@t-box/baby-diary-contracts/care'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import { computed, reactive, ref, watch } from 'vue'
import CareGlyph from './CareGlyph.vue'
import CareTimeField from './CareTimeField.vue'
import { baby, errorText } from './runtime'

const props = defineProps<{ kind: CareKind, value?: CareRecord, save: (record: CareInput, current?: CareRecord) => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const initial = props.value ? careInput(props.value) : undefined
const now = new Date().toISOString()
const form = reactive({
  occurredAt: initial?.occurredAt ?? now,
  endedAt: initial?.endedAt ?? now,
  note: initial?.note ?? '',
  contents: initial?.kind === 'diaper' ? initial.contents : 'wet' as 'wet' | 'dirty' | 'both' | 'change',
  parts: initial?.kind === 'feeding' ? initial.parts : [{ kind: 'bottle', milk: 'formula', amountMl: null }] as FeedingPart[],
})
const finished = ref(initial ? initial.state === 'completed' : props.kind !== 'sleep')
const busy = ref(false)
const error = ref('')
const title = computed(() => `${props.value ? '编辑' : '记录'}${{ feeding: '喂养', sleep: '睡眠', diaper: '尿布' }[props.kind]}`)
const nursing = computed(() => form.parts.some((part) => part.kind === 'nursing'))
watch(() => form.occurredAt, (value, old) => {
  const first = form.parts[0]
  if (first?.kind === 'nursing' && first.startedAt === old) {
    first.startedAt = value
  }
})
function mode(value: 'bottle' | 'nursing') {
  form.parts = value === 'bottle' ? [{ kind: 'bottle', milk: 'formula', amountMl: null }] : [{ kind: 'nursing', side: 'left', startedAt: form.occurredAt, endedAt: null }]
  finished.value = value === 'bottle'
}
function addBottle() {
  form.parts.push({ kind: 'bottle', milk: 'formula', amountMl: null, occurredAt: new Date().toISOString() })
}
function amount(part: FeedingPart, event: Event) {
  if (part.kind === 'bottle' && event.target instanceof HTMLInputElement) {
    part.amountMl = event.target.value === '' ? null : event.target.valueAsNumber
  }
}
async function submit() {
  busy.value = true
  error.value = ''
  try {
    const base = { occurredAt: form.occurredAt, endedAt: null, note: form.note, state: 'completed' as const }
    let input: CareInput
    if (props.kind === 'diaper') {
      input = { ...base, kind: 'diaper', contents: form.contents }
    } else if (props.kind === 'sleep') {
      input = { ...base, kind: 'sleep', state: finished.value ? 'completed' : 'running', endedAt: finished.value ? form.endedAt : null }
    } else {
      const parts = form.parts.map((part) => part.kind === 'nursing' && finished.value && !part.endedAt ? { ...part, endedAt: form.endedAt } : { ...part })
      input = { ...base, kind: 'feeding', state: !nursing.value || finished.value ? 'completed' : parts.some((part) => part.kind === 'nursing' && !part.endedAt) ? 'running' : 'paused', endedAt: nursing.value && finished.value ? form.endedAt : null, parts }
    }
    await props.save(parseCare(input), props.value)
    emit('close')
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BottomSheet
    :open="true"
    :title="title"
    :busy="busy"
    full-height
    @close="emit('close')"
  >
    <form
      id="care-form"
      class="form-stack care-form"
      @submit.prevent="submit"
    >
      <div class="care-form-baby"><CareGlyph :kind="kind" /><span>{{ baby?.name }}<small>按 {{ baby?.timezone }} 记录</small></span></div>
      <div
        v-if="kind === 'feeding' && !value"
        class="care-segments"
        aria-label="喂养方式"
      >
        <button
          type="button"
          :class="{ selected: !nursing }"
          @click="mode('bottle')"
        >瓶喂</button>
        <button
          type="button"
          :class="{ selected: nursing }"
          @click="mode('nursing')"
        >亲喂</button>
      </div>
      <CareTimeField
        v-model="form.occurredAt"
        :timezone="baby!.timezone"
        :label="kind === 'diaper' ? '发生时间' : '开始时间'"
      />
      <template v-if="kind === 'feeding'">
        <div
          v-for="(part, index) in form.parts"
          :key="index"
          class="care-part"
        >
          <div class="section-heading"><strong>{{ part.kind === 'bottle' ? '瓶喂' : '亲喂分段' }}<small v-if="form.parts.length > 1"> · {{ index + 1 }}</small></strong><button
            v-if="form.parts.length > 1"
            type="button"
            class="text-button danger-text"
            @click="form.parts.splice(index, 1)"
          >移除</button></div>
          <template v-if="part.kind === 'bottle'">
            <CareTimeField
              v-if="part.occurredAt"
              v-model="part.occurredAt"
              :timezone="baby!.timezone"
              label="本段瓶喂时间"
            />
            <SheetSelect
              v-model="part.milk"
              label="奶类"
              :options="[{ value: 'formula', label: '配方奶' }, { value: 'breast_milk', label: '母乳瓶喂' }]"
            />
            <label class="care-amount">实际喝下的奶量 <span><input
              :value="part.amountMl"
              inputmode="numeric"
              type="number"
              min="1"
              max="3000"
              step="1"
              placeholder="未知可不填"
              @input="amount(part, $event)"
            > mL</span></label>
            <p class="subtle">填写实际喝下的奶液量；不知道时留空。</p>
          </template>
          <template v-else>
            <div class="care-segments"><button
              type="button"
              :class="{ selected: part.side === 'left' }"
              @click="part.side = 'left'"
            >左侧</button><button
              type="button"
              :class="{ selected: part.side === 'right' }"
              @click="part.side = 'right'"
            >右侧</button></div>
            <CareTimeField
              v-if="index > 0 || part.startedAt !== form.occurredAt"
              v-model="part.startedAt"
              :timezone="baby!.timezone"
              label="此段开始"
            />
            <CareTimeField
              v-if="part.endedAt"
              v-model="part.endedAt"
              :timezone="baby!.timezone"
              label="此段结束"
            />
            <p v-else class="subtle">保存后开始计时，可在照护页暂停、换边和结束。</p>
          </template>
        </div>
        <button
          v-if="nursing"
          type="button"
          class="text-button"
          @click="addBottle"
        >＋ 本次还补充了瓶喂</button>
      </template>
      <div v-if="kind === 'diaper'" class="care-diaper-options">
        <button
          v-for="item in ([{ value: 'wet', label: '尿尿' }, { value: 'dirty', label: '便便' }, { value: 'both', label: '都有' }, { value: 'change', label: '仅更换' }] as const)"
          :key="item.value"
          type="button"
          :class="{ selected: form.contents === item.value }"
          @click="form.contents = item.value"
        >{{ item.label }}</button>
      </div>
      <template v-if="kind === 'sleep' || (kind === 'feeding' && nursing)">
        <label class="care-check"><input v-model="finished" type="checkbox">{{ kind === 'sleep' ? '已经醒来，补记完整睡眠' : '本次喂养已经结束' }}</label>
        <CareTimeField
          v-if="finished"
          v-model="form.endedAt"
          :timezone="baby!.timezone"
          label="结束时间"
        />
      </template>
      <label>备注（可选）<textarea
        v-model="form.note"
        maxlength="500"
        rows="2"
        placeholder="想补充的情况…"
      /></label>
      <p
        v-if="error"
        class="error"
        role="alert"
      >{{ error }}</p>
    </form>
    <template #footer><button
      class="primary full"
      :disabled="busy"
      form="care-form"
    >{{ busy ? '保存中…' : kind !== 'diaper' && !finished ? '保存并继续计时' : '保存记录' }}</button></template>
  </BottomSheet>
</template>
