<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import type { Segment } from '~/composables/useSegments'
import { segmentize } from '~/composables/useSegments'

interface DraftFork { key: string; forkFromNodeId: string; createdAt: string }
const props = defineProps<{
  nodes: TreeNode[]
  currentUserId: string
  selectedId: string | null
  /** True when the user cleared selection to start a fresh root chat */
  drafting: boolean
  /** Forks started but not yet sent — persisted, returnable, deletable entries. */
  draftForks?: DraftFork[]
  /** Key of the draft fork currently open (highlights it, suppresses chat highlight). */
  activeDraftKey?: string | null
  /** True under the selective-sharing study condition — shows each chat's visibility tag */
  showVisibility?: boolean
}>()
const emit = defineEmits<{
  (e: 'select', tipId: string): void
  (e: 'select-draft', key: string): void
  (e: 'delete-draft', key: string): void
  (e: 'new'): void
}>()

// Draft fork label: "Fork of “<origin turn snippet>”" so multiple drafts are
// distinguishable; falls back if the origin turn is no longer loaded.
function draftTitle(d: DraftFork) {
  const node = props.nodes.find((n) => n.id === d.forkFromNodeId)
  if (!node) return 'Forked chat'
  const clean = node.content.replace(/\s+/g, ' ').trim()
  const snip = clean.length > 34 ? clean.slice(0, 33) + '…' : clean
  return snip ? `Fork of “${snip}”` : 'Forked chat'
}

const summaries = useNodeSummaries()

/** Independent chats: MY OWN root trajectories + branches I forked. A
 * teammate's shared work lives on the canvas, not in here — it only becomes
 * one of "my chats" once I actually fork it (see useSegments: is_fork_point
 * is set on the forking author's own new node, never the origin's). */
const chats = computed(() => {
  const segs = segmentize(props.nodes)
  return segs
    .filter((s) => s.head.author_id === props.currentUserId && (!s.parentId || s.head.is_fork_point))
    .sort((a, b) => b.tip.created_at.localeCompare(a.tip.created_at))
})

const activeChatId = computed(() => {
  if (props.drafting || props.activeDraftKey || !props.selectedId) return null
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

// A chat's sharing state has three flavors, not two — collapsing "some but
// not all turns shared" into "private" (the old isPublic() check) hid from
// the author that they'd actually already shared part of the chat with the
// team. Mirrors TreeNode.vue's allShared/anyShared split on the canvas.
type SharingState = 'public' | 'partial' | 'private'
function sharingStateOf(seg: Segment<TreeNode>): SharingState {
  const total = seg.nodes.length
  const shared = seg.nodes.filter((n) => n.visibility === 'shared').length
  if (shared === 0) return 'private'
  return shared === total ? 'public' : 'partial'
}
function visBadge(seg: Segment<TreeNode>) {
  const state = sharingStateOf(seg)
  if (state === 'public') return { variant: 'accent' as const, label: 'Public', title: 'Visible to your whole team' }
  if (state === 'partial') {
    return {
      variant: 'warning' as const,
      label: 'Partly shared',
      title: 'Some turns are visible to your team — others are still private',
    }
  }
  return { variant: 'neutral' as const, label: 'Private', title: 'Private to you' }
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
    <div class="chathead">
      <p class="chattitle">Chat History</p>
      <UiIconButton variant="ghost" :size="30" title="New chat" @click="emit('new')">
        <AppIcon name="compose" :size="17" />
      </UiIconButton>
    </div>

    <ul class="chatlist">
      <li v-if="drafting" class="chatitem drafting active">
        <span class="ctitle">New chat</span>
        <span class="ctime">draft</span>
      </li>
      <li
        v-for="d in (draftForks ?? [])"
        :key="d.key"
        class="chatitem draftfork"
        :class="{ active: d.key === activeDraftKey }"
        @click="emit('select-draft', d.key)"
      >
        <span class="ctitle">{{ draftTitle(d) }}</span>
        <div class="cmeta">
          <span class="ctime">draft</span>
          <UiBadge variant="neutral" class="forkedtag">Forked</UiBadge>
          <button class="draftdel" title="Delete forked draft" @click.stop="emit('delete-draft', d.key)">×</button>
        </div>
      </li>
      <li
        v-for="c in chats"
        :key="c.id"
        class="chatitem"
        :class="{ active: !drafting && !activeDraftKey && c.id === activeChatId, forked: c.head.is_fork_point }"
        @click="emit('select', c.tip.id)"
      >
        <span class="ctitle">{{ titleOf(c) }}</span>
        <div class="cmeta">
          <span class="ctime">{{ onelineTime(c.tip.created_at) }}</span>
          <UiBadge v-if="c.head.is_fork_point" variant="neutral" class="forkedtag">Forked</UiBadge>
          <UiBadge
            v-if="showVisibility"
            :variant="visBadge(c).variant"
            class="vistag"
            :title="visBadge(c).title"
          >
            {{ visBadge(c).label }}
          </UiBadge>
        </div>
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
.chathead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 2px 2px 4px;
}
.chattitle {
  margin: 0;
  font-family: 'Geist', sans-serif;
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--ink);
}

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
.chatitem.active { background: var(--accent-soft); }
.chatitem.active .ctitle { color: var(--accent); font-weight: 700; }
.chatitem.active .ctime { color: var(--accent); }
.chatitem.drafting { cursor: default; border: 1px dashed var(--line); }
/* Draft forks are clickable (returnable) drafts, unlike the New-chat placeholder. */
.chatitem.draftfork { cursor: pointer; border: 1px dashed var(--line); }
.chatitem.draftfork.active { background: var(--accent-soft); border-color: var(--accent); }
.chatitem.draftfork.active .ctitle { color: var(--accent); font-weight: 700; }
.draftdel {
  flex: none;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 3px;
  border-radius: 4px;
}
.draftdel:hover { color: #c0392b; background: var(--line); }
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
.cmeta { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.ctime { font-size: 10.5px; color: var(--muted); flex: 1; }
.forkedtag, .vistag { flex: none; font-size: 9.5px; text-transform: uppercase; }
.empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
</style>
