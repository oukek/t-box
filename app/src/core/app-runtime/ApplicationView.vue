<script setup lang="ts">
import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { ApplicationManifest } from '@t-box/shared'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onErrorCaptured, provide, ref } from 'vue'
import { backFromApplication, navigation, tabLabel } from '../navigation'
import ApplicationLaunch from './ApplicationLaunch.vue'
import ApplicationUpdatePrompt from './ApplicationUpdatePrompt.vue'
import { createLaunchState, launchStateKey } from './launchState'

defineProps<{ module: ClientApplicationModule, application: ApplicationManifest, params: Record<string, string>, openRevision: number }>()
const launch = createLaunchState()
provide(launchStateKey, launch)
const error = ref(false)
const attempt = ref(0)
onErrorCaptured(() => {
  if (launch.stage.value === 'ready') {
    return
  }
  error.value = true
  launch.update('failed')
  return false
})
function retry() {
  launch.pending()
  attempt.value++
  error.value = false
}
</script>

<template>
  <section class="application-workspace">
    <ApplicationHeader
      v-if="module.navigation === 'shell' && !launch.appNavigation.value"
      :title="application.name"
      :back-label="tabLabel(navigation.backTo)"
      @back="backFromApplication"
    />
    <div
      v-if="error"
      class="application-view-error"
      role="alert"
    >
      <p>应用页面加载失败，请检查网络后重试。</p>
      <button class="button button-secondary" @click="backFromApplication">返回 OS</button>
      <button class="button button-primary" @click="retry">重新打开</button>
    </div>
    <Suspense
      v-else
      :key="attempt"
      :timeout="0"
      @pending="launch.pending"
      @resolve="launch.resolved"
    >
      <component :is="module.component" v-bind="module.props(params, { openRevision })" />
    </Suspense>
    <ApplicationLaunch
      :application="application"
      :stage="launch.stage.value"
      :resource-progress="launch.resourceProgress.value"
    />
    <ApplicationUpdatePrompt :app-id="application.id" :ready="launch.stage.value === 'ready'" />
  </section>
</template>

<style scoped>
.application-view-error {
  text-align: center;
  padding: 64px 20px;
  color: var(--muted);
}
.application-view-error button {
  margin: 8px;
}
</style>
