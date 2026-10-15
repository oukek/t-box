<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'

defineProps<{
  title: string
  backLabel: string
  description?: string
  stackActionsOnMobile?: boolean
}>()
defineEmits<{ back: [] }>()
</script>

<template>
  <header class="application-page-header">
    <button
      class="application-page-back"
      :aria-label="`返回${backLabel}`"
      :title="`返回${backLabel}`"
      @click="$emit('back')"
    >
      <AppIcon name="left" :size="21" />
    </button>
    <div class="application-page-title">
      <h1>{{ title }}</h1>
      <p v-if="description">
        {{ description }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="application-page-actions"
      :class="{ 'application-page-actions-stacked': stackActionsOnMobile }"
    >
      <slot name="actions" />
    </div>
  </header>
</template>

<style>
.application-page-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 0 12px;
  margin-bottom: 8px;
}
.application-page-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 40px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #647781;
  padding: 0;
}
.application-page-back:hover {
  color: var(--accent);
  background: #eaf0ef;
}
.application-page-title h1 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.application-page-title p {
  margin: 7px 0 0;
  font-size: 11px;
  color: #7d8c96;
  line-height: 1.6;
}
.application-page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
@media (max-width: 760px) {
  .application-page-header {
    gap: 8px;
    padding-bottom: 10px;
    margin-bottom: 6px;
  }
  .application-page-back {
    font-size: 11px;
  }
  .application-page-title h1 {
    font-size: 17px;
  }
  .application-page-title p {
    font-size: 10px;
    margin-top: 5px;
  }
  .application-page-actions-stacked {
    grid-column: auto;
    justify-content: flex-end;
  }
}
</style>
