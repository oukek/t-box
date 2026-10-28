<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ src?: string | null, size?: number, label?: string }>(), { size: 40, label: '' })
const failed = ref(false)
watch(() => props.src, () => {
  failed.value = false
})
</script>

<template>
  <span
    class="user-avatar"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : true"
    :role="label ? 'img' : undefined"
  >
    <img
      v-if="src && !failed"
      :src="src"
      alt=""
      referrerpolicy="no-referrer"
      @error="failed = true"
    >
    <svg
      v-else
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect
        width="48"
        height="48"
        rx="24"
        fill="#E4EEEA"
      />
      <circle
        cx="24"
        cy="18"
        r="7"
        fill="#83A89B"
      />
      <path d="M11 40v-3c0-7.2 5.8-12 13-12s13 4.8 13 12v3" fill="#527F70" />
    </svg>
  </span>
</template>

<style scoped>
.user-avatar {
  display: inline-flex;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  vertical-align: middle;
  background: #e4eeea;
}
.user-avatar img,
.user-avatar svg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
