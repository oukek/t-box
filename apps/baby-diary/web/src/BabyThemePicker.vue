<script setup lang="ts">
import type { BabyInput, BabyTheme } from '@t-box/baby-diary-contracts'
import { babyThemeNames, babyThemes, resolveBabyTheme } from '@t-box/baby-diary-contracts'
import { computed } from 'vue'

const props = defineProps<{ modelValue: BabyTheme | null, sex: BabyInput['sex'] }>()
const emit = defineEmits<{ 'update:modelValue': [value: BabyTheme | null] }>()
const resolved = computed(() => resolveBabyTheme(props.sex, props.modelValue))
function toggleAutomatic(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked ? null : resolved.value)
}
</script>

<template>
  <fieldset class="theme-picker">
    <legend>档案主题 · 可选</legend>
    <label class="check-row">
      <input
        type="checkbox"
        :checked="modelValue === null"
        @change="toggleAutomatic"
      >跟随性别自动选择
    </label>
    <div
      class="theme-options"
      role="radiogroup"
      aria-label="手动选择档案主题"
    >
      <label
        v-for="theme in babyThemes"
        :key="theme"
        class="theme-option"
        :class="{ selected: modelValue === theme }"
      >
        <input
          type="radio"
          name="baby-profile-theme"
          :value="theme"
          :checked="modelValue === theme"
          @change="emit('update:modelValue', theme)"
        >
        <span
          class="theme-swatch"
          :data-baby-theme="theme"
          aria-hidden="true"
        >
          <i /><i /><i />
        </span>
        <span>{{ babyThemeNames[theme] }}</span>
      </label>
    </div>
    <p class="subtle theme-description" aria-live="polite">
      {{ modelValue === null ? `自动使用${babyThemeNames[resolved]}：女宝暖粉、男宝浅蓝，未填写为中性绿。` : `已选${babyThemeNames[resolved]}，修改性别不会覆盖。` }}
      点击色卡可固定主题，保存后所有成员可见。
    </p>
  </fieldset>
</template>

<style scoped>
.theme-picker {
  display: grid;
  gap: 12px;
}
.theme-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.theme-option {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 7px 7px 10px;
  border: 1px solid var(--baby-line);
  border-radius: 12px;
  background: var(--baby-paper);
  text-align: center;
  font-size: 12px;
  cursor: pointer;
}
.theme-option.selected {
  border-color: var(--baby-accent);
  outline: 1px solid var(--baby-accent);
  outline-offset: -2px;
}
.theme-option:has(input:focus-visible) {
  outline: 2px solid var(--baby-accent);
  outline-offset: 3px;
}
.theme-option > input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  min-height: 0;
  padding: 0;
}
.theme-swatch {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
  height: 51px;
  padding: 10px;
  background: var(--baby-canvas);
  border-radius: 7px;
}
.theme-swatch i {
  width: 16px;
  height: 23px;
  border-radius: 8px 8px 3px 3px;
  background: var(--baby-accent);
}
.theme-swatch i:nth-child(2) {
  height: 31px;
  background: var(--baby-accent-muted);
}
.theme-swatch i:nth-child(3) {
  height: 18px;
  background: var(--baby-sun);
}
.theme-description {
  margin: 0;
  font-size: 11px;
}
</style>
