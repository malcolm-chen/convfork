<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { MergedNode } from '~/composables/useMergedNodes'

const props = defineProps<{
  node: MergedNode
  memberNames: Record<string, string>
  currentUserId: string
  // Canvas filter bar: when set, a merge counts as this author's if they
  // created it or contributed one of its source segments (see TreeNode.vue's
  // matching highlight/dimmed pattern).
  highlightAuthorId?: string | null
  // Merged cards aren't concept-tagged in v1 — they never match a topic
  // filter, so any active one just dims them like any other non-match.
  highlightConceptId?: string | null
}>()
const emit = defineEmits<{
  (e: 'fork', mergedNodeId: string): void
  (e: 'delete', mergedNodeId: string): void
}>()

const isAuthor = computed(() => props.currentUserId === props.node.createdBy)

const isHighlighted = computed(() => {
  if (!props.highlightAuthorId) return false
  return props.node.createdBy === props.highlightAuthorId
    || props.node.sources.some((s) => s.authorId === props.highlightAuthorId)
})
const isDimmed = computed(
  () => (!!props.highlightAuthorId && !isHighlighted.value) || !!props.highlightConceptId,
)

const contributors = computed(() => {
  const seen = new Set<string>()
  const out: { id: string; name: string }[] = []
  for (const s of props.node.sources) {
    if (seen.has(s.authorId)) continue
    seen.add(s.authorId)
    out.push({ id: s.authorId, name: props.memberNames[s.authorId] ?? '?' })
  }
  return out
})

const mergedByName = computed(() => props.memberNames[props.node.createdBy] ?? 'Unknown')
</script>

<template>
  <div class="mergecard" :class="{ highlight: isHighlighted, dimmed: isDimmed }">
    <!-- Target: one incoming edge per source segment. Source: the outgoing
         edge to whatever was forked from this merged node (ReasoningTree.vue
         connects a merge-forked segment's card back here via 'card-src'),
         so a merge-forked branch reads as continuing from this card instead
         of sitting isolated — geometry only, same invisible-handle pattern
         as TreeNode.vue's .cardhandle. -->
    <Handle type="target" :position="Position.Left" class="cardhandle" />
    <Handle id="card-src" type="source" :position="Position.Right" class="cardhandle" />

    <div class="mhdr">
      <span class="micon"><AppIcon name="merge" :size="15" /></span>
      <h3 class="mtitle">{{ node.title }}</h3>
    </div>
    <p class="msummary">{{ node.summary }}</p>
    <div class="msourcerow">
      <span class="mmeta">{{ node.sources.length }} conversation node{{ node.sources.length === 1 ? '' : 's' }}</span>
      <div class="mcontrib">
        <UiAvatar v-for="c in contributors" :key="c.id" class="cavatar" :name="c.name" :color-key="c.id" :size="20" />
      </div>
    </div>
    <div class="mfoot">
      <div class="mauthor">
        <UiAvatar class="mauthoravatar" :name="mergedByName" :color-key="node.createdBy" :size="18" />
        <span class="mauthorlabel">Merged by <strong>{{ mergedByName }}</strong></span>
      </div>
      <div class="mactions">
        <UiButton v-if="isAuthor" variant="danger" size="sm" @click.stop="emit('delete', node.id)">Delete</UiButton>
        <UiButton variant="primary" size="sm" @click.stop="emit('fork', node.id)">Fork</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mergecard {
  position: relative;
  width: 260px;
  box-sizing: border-box;
  padding: 13px 14px;
  background: var(--accent-soft);
  border: 1px solid #d3cdf7;
  border-radius: 14px;
  font-size: 12px;
  box-shadow: 0 2px 10px rgba(20, 20, 30, 0.06);
  transition: box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.mergecard.highlight { border-color: var(--highlight); box-shadow: 0 0 0 2px var(--highlight); }
.mergecard.dimmed { opacity: 0.4; }
.cardhandle { opacity: 0; pointer-events: none; }

.mhdr { display: flex; align-items: center; gap: 7px; }
.micon {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
}
.mtitle {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-family: 'Geist', sans-serif;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--ink);
  line-height: 1.3;
}
.msummary { margin: 8px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--ink); }

.msourcerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.mmeta { font-size: 10.5px; color: var(--muted); }
.mcontrib { display: flex; }
.cavatar { margin-right: -6px; border: 2px solid var(--accent-soft); }

.mfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.mauthor { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; color: var(--ink); }
.mauthoravatar { flex: none; border: 2px solid var(--accent-soft); }
.mauthorlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mauthorlabel strong { font-weight: 700; }
.mactions { flex: none; display: flex; gap: 8px; }
</style>
