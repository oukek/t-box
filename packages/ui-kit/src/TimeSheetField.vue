<script setup lang="ts">
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const hour = ref('09')
const minute = ref('00')
watch(open, (value) => {
  if (value) {
    const parts = props.modelValue.split(':')
    hour.value = parts[0] || '09'
    minute.value = parts[1] || '00'
  }
})
const valid = computed(
  () =>
    /^\d{1,2}$/.test(hour.value) &&
    Number(hour.value) < 24 &&
    /^\d{1,2}$/.test(minute.value) &&
    Number(minute.value) < 60,
)
function confirm() {
  if (!valid.value) {
    return
  }
  emit(
    'update:modelValue',
    `${hour.value.padStart(2, '0')}:${minute.value.padStart(2, '0')}`,
  )
  open.value = false
}
</script>

<template>
  <button
    type="button"
    class="temporal-time-trigger"
    :aria-label="`${label}：${modelValue}`"
    :disabled="disabled"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <span>{{ modelValue }}</span><AppIcon name="clock" :size="17" />
  </button><BottomSheet
    :open="open"
    :title="label"
    @close="open = false"
  >
    <div class="temporal-time-draft">
      <label>小时<input
        v-model="hour"
        aria-label="小时"
        inputmode="numeric"
        maxlength="2"
        @keydown.enter="confirm"
      ></label><span>:</span><label>分钟<input
        v-model="minute"
        aria-label="分钟"
        inputmode="numeric"
        maxlength="2"
        @keydown.enter="confirm"
      ></label>
    </div>
    <div class="temporal-time-presets">
      <button
        v-for="value in ['00:00', '08:00', '09:00', '12:00', '18:00', '23:00']"
        :key="value"
        @click="[hour, minute] = value.split(':') as [string, string]"
      >
        {{ value }}
      </button>
    </div>
    <template #footer>
      <button class="button button-secondary" @click="open = false"> 取消</button><button
        class="button button-primary"
        :disabled="!valid"
        @click="confirm"
      >
        确定
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.temporal-time-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 44px;
  padding: 11px 12px;
  background: white;
  border: 1px solid #dce5e8;
  border-radius: 9px;
  color: #385363;
  font-size: 12px;
}
.temporal-time-trigger svg {
  color: #8ca09f;
}
.temporal-time-draft {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  padding: 20px 0;
}
.temporal-time-draft label {
  display: grid;
  gap: 10px;
  font-size: 12px;
  color: #8a9b91;
}
.temporal-time-draft input {
  width: 90px;
  padding: 12px;
  text-align: center;
  font:
    32px ui-monospace,
    monospace;
  border: 1px solid #dce5e2;
  border-radius: 12px;
  color: #294c3a;
}
.temporal-time-presets {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.temporal-time-presets button {
  border: 1px solid #e1e8e3;
  border-radius: 9px;
  background: #f4f8f5;
  padding: 12px;
  font-size: 13px;
  color: #647f70;
}
</style>
