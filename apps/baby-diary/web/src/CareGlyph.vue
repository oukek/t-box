<script setup lang="ts">
defineProps<{ kind: 'feeding' | 'sleep' | 'diaper' }>()
</script>

<template>
  <svg
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="kind === 'feeding'">
      <path d="M19 14v-3c0-7 10-7 10 0v3M17 15h14v6H17zM18 21l-3 8v10c0 4 18 4 18 0V29l-3-8" />
      <path d="M16 31h16M24 26h5M24 36h5" />
      <path d="M8 12h5M10.5 9.5v5M36 19h4" opacity=".5" />
    </template>
    <template v-else-if="kind === 'sleep'">
      <path d="M34 29A16 16 0 0 1 19 8a17 17 0 1 0 15 21Z" />
      <path
        d="m31 8 1.5 4.5L37 14l-4.5 1.5L31 20l-1.5-4.5L25 14l4.5-1.5ZM39 25h4M41 23v4"
        fill="currentColor"
        stroke-width="1"
      />
    </template>
    <template v-else>
      <path d="M7 17h34v10c-3 2-6 8-7 13H14c-1-5-4-11-7-13ZM7 17l3-7h28l3 7M14 17l3 8h14l3-8" />
      <path d="M7 25c7 0 13 6 13 15M41 25c-7 0-13 6-13 15M22 30h.1M26 30h.1M22 34c1.5 1 2.5 1 4 0" />
    </template>
  </svg>
</template>
