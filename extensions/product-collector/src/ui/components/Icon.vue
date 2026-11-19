<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10',
  scan: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8h10M7 12h10M7 16h6',
  layers: 'M12 3L2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  download: 'M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5',
  search: 'M21 21l-6-6M17 10a7 7 0 11-14 0 7 7 0 0114 0',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  check: 'M5 12l4 4L19 6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 11-20 0 10 10 0 0120 0',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  image: 'M3 3h18v18H3V3zm0 13l5-5 5 5 4-4 4 4M15 7h.01',
}
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.box" />
  </svg>
</template>
