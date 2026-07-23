<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import type { Segment } from '~/composables/useSegments'
import { segmentize } from '~/composables/useSegments'

const props = defineProps<{
  nodes: TreeNode[]
  selectedId: string | null
  /** True when the user cleared selection to start a fresh root chat */
  drafting: boolean
}>()
const emit = defineEmits<{
  (e: 'select', tipId: string): void
  (e: 'new'): void
}>()

const summaries = useNodeSummaries()

/** Independent chats: root trajectories + explicitly forked branches. */
const chats = computed(() => {
  const segs = segmentize(props.nodes)
  return segs
    .filter((s) => !s.parentId || s.head.is_fork_point)
    .sort((a, b) => b.tip.created_at.localeCompare(a.tip.created_at))
})

const activeChatId = computed(() => {
  if (props.drafting || !props.selectedId) return null
  const segs = segmentize(props.nodes)
  const byId = new Map(segs.map((s) => [s.id, s]))
  let cur = segs.find((s) => s.nodes.some((n) => n.id === props.selectedId))
  if (!cur) return null
  while (cur.parentId && !cur.head.is_fork_point) {
    const parent = byId.get(cur.parentId)
    if (!parent) break
    cur = parent
  }
  return cur.id
})

function transcriptOf(seg: Segment<TreeNode>) {
  return seg.nodes
    .map((n) => `${n.role === 'assistant' ? 'Assistant' : 'User'}: ${n.content}`)
    .join('\n\n')
}

function titleOf(seg: Segment<TreeNode>) {
  const t = transcriptOf(seg)
  const entry = summaries.get(summaries.keyFor(t))
  if (entry?.status === 'done' && entry.text) return entry.text
  const starter = seg.nodes.find((n) => n.role === 'user') ?? seg.head
  const clean = starter.content.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? clean.slice(0, 47) + '…' : clean || 'Untitled chat'
}

watch(
  chats,
  (list) => {
    for (const s of list) summaries.request(transcriptOf(s))
  },
  { immediate: true },
)

function onelineTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="chatside">
    <button type="button" class="newchat" @click="emit('new')">
      <span class="plus">+</span>
      New chat
    </button>

    <ul class="chatlist">
      <li v-if="drafting" class="chatitem drafting active">
        <span class="ctitle">New chat</span>
        <span class="ctime">draft</span>
      </li>
      <li
        v-for="c in chats"
        :key="c.id"
        class="chatitem"
        :class="{ active: !drafting && c.id === activeChatId, forked: c.head.is_fork_point }"
        @click="emit('select', c.tip.id)"
      >
        <span class="ctitle">{{ titleOf(c) }}</span>
        <span class="ctime">{{ onelineTime(c.tip.created_at) }}</span>
      </li>
      <li v-if="!chats.length && !drafting" class="empty">No chats yet</li>
    </ul>
  </div>
</template>

<style scoped>
.chatside {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 168px;
  flex: none;
  padding: 12px 10px;
  border-right: 1px solid var(--line);
  background: var(--paper);
  min-height: 0;
}
.newchat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 9px 10px;
  border: 1px dashed var(--accent);
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-style 0.15s ease;
}
.newchat:hover { background: var(--accent); color: #fff; border-style: solid; }
.plus { font-size: 15px; line-height: 1; }

.chatlist {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.chatitem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.chatitem:hover { background: var(--accent-soft); }
.chatitem.active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.chatitem.drafting { cursor: default; border: 1px dashed var(--line); }
.chatitem.forked .ctitle::before {
  content: '⑂ ';
  color: var(--muted);
  font-weight: 500;
}
.ctitle {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ctime { font-size: 10.5px; color: var(--muted); }
.empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
</style>
