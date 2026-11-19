<script setup lang="ts">
import type { AdminPage } from '../core/navigation'
import { ref, useId, watch } from 'vue'
import { navigationGroups } from '../core/navigation'
import AdminButton from './AdminButton.vue'
import AdminIcon from './AdminIcon.vue'

const props = defineProps<{
  current: AdminPage
  pages: Record<AdminPage, { title: string, symbol: string }>
}>()
const emit = defineEmits<{ navigate: [page: AdminPage] }>()
const expanded = ref(new Set<string>())
const prefix = useId()
watch(
  () => props.current,
  (current) => {
    const group = navigationGroups.find((g) =>
      g.pages.some((p) => p === current),
    )
    if (group) {
      expanded.value.add(group.id)
    }
  },
  { immediate: true },
)
function toggle(id: string) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
  }
}
</script>

<template>
  <nav class="admin-nav" aria-label="后台导航">
    <section
      v-for="group in navigationGroups"
      :key="group.id"
      class="nav-group"
    >
      <AdminButton
        class="nav-group-toggle"
        :class="{ 'contains-current': group.pages.some((p) => p === current) }"
        :aria-expanded="expanded.has(group.id)"
        :aria-controls="`${prefix}-${group.id}`"
        @click="toggle(group.id)"
      ><AdminIcon :name="group.symbol" :size="17" /><span>{{
        group.title
      }}</span><AdminIcon
        name="chevron"
        :size="14"
        class="nav-chevron"
        :class="{ expanded: expanded.has(group.id) }"
      /></AdminButton>
      <div
        v-show="expanded.has(group.id)"
        :id="`${prefix}-${group.id}`"
        class="nav-group-pages"
      >
        <a
          v-for="key in group.pages"
          :key="key"
          :href="`#/${key}`"
          class="nav-link"
          :class="{ active: current === key }"
          :aria-current="current === key ? 'page' : undefined"
          @click.prevent="emit('navigate', key)"
        >{{ pages[key].title }}</a>
      </div>
    </section>
  </nav>
</template>

<style scoped>
.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.admin-nav .nav-group-toggle {
  width: 100%;
  min-height: 40px;
  border: 0;
  background: transparent;
  color: #687386;
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.nav-group-toggle > span {
  flex: 1;
  text-align: left;
}
.admin-nav .contains-current {
  color: var(--accent);
}
.admin-nav .nav-group-toggle:hover {
  background: #f7f9ff;
}
.nav-chevron {
  transition: transform 0.15s;
  transform: rotate(-90deg);
}
.nav-chevron.expanded {
  transform: rotate(0);
}
.nav-group-pages {
  display: grid;
  gap: 3px;
  margin: 2px 0 7px 18px;
  padding-left: 10px;
  border-left: 1px solid var(--line);
}
.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 35px;
  border-radius: 7px;
  padding: 7px 10px;
  color: #687386;
  text-decoration: none;
  font-size: 12px;
}
.nav-link:hover {
  background: #f7f9ff;
  color: var(--accent);
}
.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.nav-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .nav-chevron {
    transition: none;
  }
}
</style>
