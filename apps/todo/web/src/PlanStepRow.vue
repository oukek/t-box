<script setup lang="ts">
import type { Step } from '@t-box/todo-contracts'
import FormControl from '@t-box/ui-kit/FormControl.vue'

defineProps<{ step: Step, disabled: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <label class="day-step">
    <FormControl
      type="checkbox"
      :checked="!!step.done"
      :disabled="disabled"
      @change="$emit('toggle')"
    />
    <span class="day-step-copy">
      <span :class="{ finished: step.done }">{{ step.title }}</span>
      <small v-if="step.stage || step.date">
        {{ step.stage }}<span v-if="step.stage && step.date"> · </span><time v-if="step.date" :datetime="step.date">{{ step.date }}</time>
      </small>
    </span>
    <span v-if="step.urgent" class="urgent">紧急</span>
    <span v-if="step.milestone" class="milestone-tag"><span aria-hidden="true">◆</span> 里程碑</span>
  </label>
</template>
