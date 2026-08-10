<script setup lang="ts">
import type { ConceptTag } from '~/composables/useConcepts'

// Below the canvas top bar: pick a dimension (author or topic) and a value
// within it — matching nodes get a highlighted border, the rest dim
// slightly (see TreeNode.vue's `highlight`/`dimmed` classes). Only one
// dimension is active at a time (see pages/conversation/[id].vue).
// Each picker is a native <select> overlaid on a pill (same pattern as
// Composer.vue's model picker) so the dropdown opens right at the control
// you clicked, rather than a separate element elsewhere in the bar.
defineProps<{
  authors: { id: string; name: string }[]
  authorId: string | null
  topics: ConceptTag[]
  conceptId: string | null
}>()
const emit = defineEmits<{
  (e: 'update:author-id', id: string | null): void
  (e: 'update:concept-id', id: string | null): void
}>()

function onAuthorChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('update:author-id', v || null)
}
function onConceptChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('update:concept-id', v || null)
}
function clear() {
  emit('update:author-id', null)
  emit('update:concept-id', null)
}
</script>

<template>
  <div class="filterbar">
    <span class="filterlabel"><AppIcon name="filter" :size="12" /> Filter by</span>
    <label class="filterpill">
      <select
        class="filterselect"
        :class="{ active: !!authorId }"
        :value="authorId ?? ''"
        @change="onAuthorChange"
      >
        <option value="">Author</option>
        <option v-for="a in authors" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <AppIcon name="chevron-down" :size="11" class="filtercaret" />
    </label>
    <label class="filterpill">
      <select
        class="filterselect"
        :class="{ active: !!conceptId }"
        :value="conceptId ?? ''"
        @change="onConceptChange"
      >
        <option value="">Topic</option>
        <option v-for="t in topics" :key="t.id" :value="t.id" :title="t.description">{{ t.name }}</option>
      </select>
      <AppIcon name="chevron-down" :size="11" class="filtercaret" />
    </label>
    <button v-if="authorId || conceptId" type="button" class="clearbtn" @click="clear">
      <AppIcon name="x" :size="11" /> Clear
    </button>
  </div>
</template>

<style scoped>
.filterbar {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 9px 22px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  font-size: 12.5px;
}
.filterlabel {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--muted);
  font-weight: 600;
}

.filterpill { position: relative; display: inline-flex; align-items: center; flex: none; }
.filterselect {
  appearance: none;
  min-width: 96px;
  padding: 5px 26px 5px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.filterselect.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.filtercaret { position: absolute; right: 9px; pointer-events: none; color: var(--muted); }

.clearbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
}
.clearbtn:hover { color: var(--ink); }
</style>
