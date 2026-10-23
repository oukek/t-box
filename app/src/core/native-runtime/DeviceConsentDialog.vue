<script setup lang="ts">
import { deviceCapabilityLabels } from '@t-box/app-contracts'
import { Modal } from '@t-box/ui-kit'
import { deviceConsent } from './consent'
</script>

<template>
  <Modal
    :open="!!deviceConsent.current"
    title="应用设备权限"
    @close="deviceConsent.current?.resolve(false)"
  >
    <template v-if="deviceConsent.current">
      <p v-if="deviceConsent.current.description">{{ deviceConsent.current.description }}</p>
      <p v-else>允许“{{ deviceConsent.current.appName }}”使用以下本机能力？</p>
      <ul><li v-for="item in deviceConsent.current.capabilities" :key="item">{{ deviceCapabilityLabels[item] }}</li></ul>
      <p v-if="!deviceConsent.current.description" class="muted">系统权限会在使用时单独询问；可在设置中撤销应用授权。</p>
      <div class="dialog-actions"><button class="button button-secondary" @click="deviceConsent.current?.resolve(false)">不允许</button><button class="button" @click="deviceConsent.current?.resolve(true)">允许</button></div>
    </template>
  </Modal>
</template>
