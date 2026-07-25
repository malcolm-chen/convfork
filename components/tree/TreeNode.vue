<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { TreeNode, Reaction } from '~/composables/useConversation'
import type { Segment } from '~/composables/useSegments'

// One card = one conversation trajectory (segment), not one turn.
const props = defineProps<{
  segment: Segment<TreeNode>
  reactionsByNode: Map<string, Reaction[]>
  selectedId: string | null
  currentUserId: string
  memberNames: Record<string, string>
  showVisibility?: boolean
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'fork', id: string): void
  (e: 'react', payload: { nodeId: string; type: string }): void
  (e: 'unreact', payload: { id: string; nodeId: string; type: string }): void
}>()

const tip = computed(() => props.segment.tip)
const isSelected = computed(() => props.segment.nodes.some((n) => n.id === props.selectedId))

// The trajectory belongs to whoever started it (first user turn).
const starter = computed(
  () => props.segment.nodes.find((n) => n.role === 'user') ?? props.segment.head,
)
const authorName = computed(() => props.memberNames[starter.value.author_id] ?? 'Unknown')
const authorColor = computed(() => avatarColors(starter.value.author_id))

const allShared = computed(() => props.segment.nodes.every((n) => n.visibility === 'shared'))
const anyShared = computed(() => props.segment.nodes.some((n) => n.visibility === 'shared'))
const visGlyph = computed(() => (allShared.value ? '🌐' : anyShared.value ? '◐' : '🔒'))
const visTitle = computed(() =>
  allShared.value ? 'shared' : anyShared.value ? 'partly shared' : 'private',
)

// Reactions anyone left anywhere on the trajectory; new ones attach to the
// HEAD node — its id is stable for the segment's lifetime.
const segReactions = computed(() =>
  props.segment.nodes.flatMap((n) => props.reactionsByNode.get(n.id) ?? []),
)

// ── Auto-summary (ChatGPT-sidebar style) instead of raw turns ──
const summaries = useNodeSummaries()
const transcript = computed(() =>
  props.segment.nodes
    .map((n) => `${n.role === 'assistant' ? 'Assistant' : 'User'}: ${n.content}`)
    .join('\n\n'),
)
const sumKey = computed(() => summaries.keyFor(transcript.value))
const entry = computed(() => summaries.get(sumKey.value))
watch(transcript, (t) => summaries.request(t), { immediate: true })

const title = computed(() => {
  const e = entry.value
  return e?.status === 'done' && e.text ? e.text : null
})
const loading = computed(() => !title.value && entry.value?.status !== 'error')

// Never leave the card blank if summarizing fails — fall back to the opener.
function oneline(text: string, len = 70) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}
const fallback = computed(() => oneline(starter.value.content))
</script>

<template>
  <div
    class="tnode"
    :class="{ sel: isSelected, forkpt: segment.head.is_fork_point }"
    @click="emit('select', tip.id)"
  >
    <Handle type="target" :position="Position.Top" />

    <div class="hdr">
      <span class="author" :style="{ color: authorColor.color }">{{ authorName }}</span>
      <span v-if="segment.head.is_fork_point" class="forkbadge">⑂ fork</span>
      <span class="turns">{{ segment.nodes.length }} turn{{ segment.nodes.length === 1 ? '' : 's' }}</span>
      <span class="vis" v-if="showVisibility !== false" :title="visTitle">{{ visGlyph }}</span>
    </div>

    <p class="summary" :class="{ ph: !title }" :title="title || fallback">
      <template v-if="title">{{ title }}</template>
      <span v-else-if="loading" class="shimmer">Summarizing…</span>
      <template v-else>{{ fallback }}</template>
    </p>

    <div class="toolbar" @click.stop>
      <ReactionBar
        :reactions="segReactions"
        :current-user-id="currentUserId"
        :member-names="memberNames"
        @react="(t) => emit('react', { nodeId: segment.id, type: t })"
        @unreact="(p) => emit('unreact', p)"
      />
      <span class="spacer" />
      <ForkButton
        :segment="segment"
        :current-user-id="currentUserId"
        :member-names="memberNames"
        @fork="(id) => emit('fork', id)"
      />
    </div>

    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.tnode {
  width: 300px;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  padding: 9px 10px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(29, 32, 41, 0.05);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.tnode:hover { border-color: #c8cfe8; box-shadow: 0 4px 12px rgba(29, 32, 41, 0.08); }
.tnode.sel { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); }

.hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.author {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.forkbadge {
  flex: none;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 1px 5px;
}
.turns { flex: none; margin-left: auto; font-size: 10px; color: var(--muted); }
.vis { flex: none; font-size: 10px; }

/* LLM title — the gist of the branch, not its raw turns */
.summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.summary.ph { color: var(--muted); }
.shimmer {
  color: var(--muted);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.45; } }

.toolbar { display: flex; align-items: center; gap: 4px; margin-top: 9px; }
.spacer { flex: 1; }
</style>
