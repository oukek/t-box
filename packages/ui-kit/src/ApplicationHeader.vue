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
