<script setup lang="ts">
import type { MarketApp } from './presentation'
import { AppIcon } from '@t-box/ui-kit'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed } from 'vue'
import { actionLabel, displayApp, hasUpdate, isInstalled, isProcessing, stateLabel } from './presentation'

const props = defineProps<{ entry: MarketApp, busy: boolean }>()
defineEmits<{ inspect: [entry: MarketApp], activate: [entry: MarketApp] }>()
const app = computed(() => displayApp(props.entry))
</script>

<template>
  <article
    class="market-card"
    :class="{ 'market-card--optional': entry.release.kind === 'user' }"
    :aria-label="app.name"
  >
    <button
      class="market-card-identity"
      :aria-label="`查看${app.name}详情`"
      @click="$emit('inspect', entry)"
    >
      <LauncherIcon
        :app-id="entry.release.appId"
        :icon="app.icon"
        :icon-asset="app.iconAsset"
        :icon-variant="app.iconVariant"
      />
      <span class="market-card-copy"><strong>{{ app.name }}</strong><span class="market-card-description">{{ app.description }}</span></span>
    </button>
    <button
      class="market-action"
      :class="{ 'market-action--open': isInstalled(entry) && !hasUpdate(entry) }"
      :disabled="busy || isProcessing(entry)"
      :aria-label="`${actionLabel(entry)}${app.name}`"
      @click="$emit('activate', entry)"
    >
      <AppIcon
        v-if="isProcessing(entry)"
        class="market-spinning"
        name="refresh"
        :size="13"
      />
      {{ actionLabel(entry) }}
    </button>
    <div class="market-card-meta">
      <span class="market-card-state" :class="{ 'has-update': hasUpdate(entry), 'has-error': entry.installation?.status === 'failed' }"><i aria-hidden="true" />{{ stateLabel(entry) }}</span>
      <span class="market-card-version">v{{ entry.release.manifest.version }}</span>
      <span v-if="entry.release.manifest.skillIds.length" class="market-ai-tag"><AppIcon name="sparkle" :size="11" />支持 AI</span>
    </div>
  </article>
</template>
