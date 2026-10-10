<script setup lang="ts">
import { ref } from "vue";
import { BottomSheet, AppIcon } from "@t-box/ui-kit";
import type { LedgerRecordKind } from "@t-box/ledger-contracts";
import RecordAttachments from "./RecordAttachments.vue";
defineProps<{
  ledgerId: string;
  kind: LedgerRecordKind;
  recordId: string;
  canWrite: boolean;
}>();
const open = ref(false);
</script>
<template>
  <button type="button" class="text-button" @click="open = true">
    <AppIcon name="attach" :size="14" />附件</button
  ><BottomSheet
    :open="open"
    title="记录附件"
    full-height
    compact
    @close="open = false"
    ><RecordAttachments
      v-if="open"
      :ledger-id="ledgerId"
      :kind="kind"
      :record-id="recordId"
      :can-write="canWrite"
  /></BottomSheet>
</template>
