<script setup lang="ts">
withDefaults(defineProps<{ name: string, size?: number }>(), { size: 20 })

const paths: Record<string, string> = {
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
  calculator:
    'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2 M8 7h8 M8 11h1 M12 11h1 M16 11h.1 M8 15h1 M12 15h1 M16 15v3 M8 18h1 M12 18h1',
  support:
    'M4 13v-2a8 8 0 0 1 16 0v2 M4 12H2v6h4v-6z M20 12h2v6h-4v-6z M20 18a4 4 0 0 1-4 4h-4 M10 22h4',
  wallet: 'M4 6h15v14H4z M4 6V4h13 M15 11h6v5h-6z M17 13.5h.01',
  join: 'M10 4h10v16H10 M3 12h11 M10 8l4 4-4 4',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  share:
    'M16 5a3 3 0 1 1 6 0 3 3 0 0 1-6 0 M2 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0 M16 19a3 3 0 1 1 6 0 3 3 0 0 1-6 0 M8 10l8-4 M8 14l8 4',
  userPlus:
    'M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M3 21v-2a7 7 0 0 1 11-5 M19 13v8 M15 17h8',
  exchange: 'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 11v5 M12 7h.01',
  lock: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  task: 'M10 6h11 M10 12h11 M10 18h11 M3 6l1 1 2-2 M3 12l1 1 2-2 M3 18l1 1 2-2',
  history: 'M3 11a9 9 0 1 1 2.6 7 M3 4v7h7 M12 7v5l3 2',
  attach: 'm8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9 M6 14l8-8',
  image:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M3 17l6-6 4 4 3-3 5 5 M16 7h.01',
  file: 'M5 3h9l5 5v13H5z M14 3v5h5 M8 13h8 M8 17h5',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  logout: 'M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4',
  home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',
  apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  chat: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 1 1 18 0 M7 10h10 M7 14h6',
  send: 'M12 20V4 M5 11l7-7 7 7',
  stop: 'M6 6h12v12H6z',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  connection:
    'M3 8a14 14 0 0 1 18 0 M6 12a9 9 0 0 1 12 0 M9 16a4 4 0 0 1 6 0 M12 20h.01',
  ledger: 'M5 3h14v18H5z M9 3v18 M12 8h4 M12 12h4 M12 16h2',
  plus: 'M12 5v14 M5 12h14',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  arrowDown: 'M12 4v16 M6 14l6 6 6-6',
  arrowUp: 'M12 20V4 M6 10l6-6 6 6',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  close: 'm6 6 12 12 M6 18 18 6',
  edit: 'm14 5 5 5 M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15z',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  check: 'm5 12 4 4L19 6',
  calendar:
    'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2 M7 3v4 M17 3v4 M3 11h18 M7 15h2 M13 15h2',
  food: 'M5 3v7a3 3 0 0 0 6 0V3 M8 3v18 M18 3c-3 3-4 7 0 8h1 M19 3v18',
  transport:
    'M5 16h14V6a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3z M5 9h14 M8 16l-2 5 M16 16l2 5 M8 13h1 M15 13h1 M7 19h10',
  shopping: 'M5 7h14l2 14H3z M8 8V6a4 4 0 0 1 8 0v2',
  housing: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  entertainment:
    'm9 3 12-1v14 M9 3v15 M9 7l12-1 M9 18a3 3 0 1 0-3 3 3 3 0 0 0 3-3 M21 16a3 3 0 1 0-3 3 3 3 0 0 0 3-3',
  health:
    'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2 M9 5V3h6v2 M12 10v7 M8.5 13.5h7',
  salary:
    'M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1 M8 7V3h8v4 M3 12a22 22 0 0 0 18 0 M10 12v3h4v-3',
  bonus:
    'M3 8h18v5H3z M5 13v8h14v-8 M12 8v13 M12 8C3 8 4 1 8 3c3 1 4 5 4 5 M12 8c9 0 8-7 4-5-3 1-4 5-4 5',
  other: 'M5 5h4v4H5z M15 5h4v4h-4z M5 15h4v4H5z M15 15h4v4h-4z',
  warning: 'M12 3 2 21h20z M12 9v5 M12 17v.1',
  refresh: 'M20 7a9 9 0 0 0-16 2 M20 3v5h-5 M4 17a9 9 0 0 0 16-2 M4 21v-5h5',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.other" />
  </svg>
</template>
