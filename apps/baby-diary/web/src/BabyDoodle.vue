<script setup lang="ts">
withDefaults(defineProps<{
  scene?: 'welcome' | 'memory' | 'growth' | 'photos' | 'avatar'
}>(), { scene: 'memory' })
</script>

<template>
  <svg
    class="baby-doodle"
    :class="`baby-doodle--${scene}`"
    :viewBox="scene === 'avatar' ? '45 36 110 96' : '0 0 200 150'"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="scene !== 'avatar'">
      <ellipse
        cx="99"
        cy="136"
        rx="70"
        ry="5"
        fill="var(--baby-accent-soft)"
      />
      <path
        d="M23 46c-9-1-11-13-3-17 1-12 19-16 25-5 12-1 16 17 4 21Z"
        fill="var(--baby-sky-soft)"
      />
      <circle
        cx="166"
        cy="27"
        r="13"
        fill="var(--baby-sun)"
      />
      <path
        d="m166 7 1-5m18 25 6 1m-11-15 4-4m-37 8-4-3"
        stroke="var(--baby-sun)"
        stroke-width="3"
        stroke-linecap="round"
      />
    </template>
    <g
      v-if="scene === 'photos'"
      stroke="var(--baby-line)"
      stroke-width="2"
    >
      <rect
        x="23"
        y="42"
        width="83"
        height="90"
        rx="8"
        transform="rotate(-13 23 42)"
        fill="var(--baby-paper)"
      />
      <rect
        x="118"
        y="27"
        width="73"
        height="98"
        rx="8"
        transform="rotate(12 118 27)"
        fill="var(--baby-paper)"
      />
      <path
        d="m144 67 8 9 14-20"
        stroke="var(--baby-accent-muted)"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <g v-if="scene === 'welcome' || scene === 'memory'" transform="rotate(-7 98 86)">
      <rect
        x="49"
        y="26"
        width="103"
        height="112"
        rx="13"
        fill="var(--baby-accent-soft)"
        stroke="var(--baby-accent-muted)"
        stroke-width="2.5"
      />
      <path
        d="M65 28v108M44 50h14m-14 25h14m-14 25h14"
        stroke="var(--baby-accent)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </g>
    <g v-if="scene === 'growth'">
      <rect
        x="37"
        y="38"
        width="22"
        height="96"
        rx="7"
        fill="var(--baby-sun-soft)"
      />
      <path
        d="M39 56h9m-9 19h13m-13 19h9m-9 19h13"
        stroke="var(--baby-ochre)"
        stroke-width="2"
        stroke-linecap="round"
      />
    </g>
    <g
      :transform="scene === 'avatar' ? '' : 'translate(4 4)'"
      stroke="var(--baby-ochre)"
      stroke-width="2.5"
      stroke-linejoin="round"
    >
      <circle
        cx="73"
        cy="58"
        r="14"
        fill="var(--baby-sun)"
      />
      <circle
        cx="126"
        cy="58"
        r="14"
        fill="var(--baby-sun)"
      />
      <path d="M65 81c-1-38 70-42 70 0 1 23-13 37-35 37-23 0-36-14-35-37Z" fill="var(--baby-sun)" />
      <ellipse
        cx="100"
        cy="94"
        rx="18"
        ry="13"
        fill="var(--baby-paper)"
        stroke="none"
      />
      <path
        d="M96 90q4-5 8 0l-4 4Z"
        fill="var(--baby-ink)"
        stroke="none"
      />
      <path
        d="M100 94v4m-7 1q7 7 14 0"
        stroke="var(--baby-ink)"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M84 80v3m31-3v3"
        stroke="var(--baby-ink)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </g>
    <g
      v-if="scene !== 'avatar'"
      stroke="var(--baby-accent)"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M157 132v-21" stroke-width="2.5" />
      <path
        d="M157 121q-20-1-17-15 16-1 17 15Zm0-7q0-19 17-18 1 16-17 18Z"
        fill="var(--baby-accent-muted)"
        stroke-width="2"
      />
    </g>
  </svg>
</template>

<style scoped>
.baby-doodle {
  display: block;
  width: 180px;
  height: auto;
  flex-shrink: 0;
}
.baby-doodle--avatar {
  width: 100%;
  height: 100%;
}
</style>
