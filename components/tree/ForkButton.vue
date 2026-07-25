<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import type { Segment } from '~/composables/useSegments'

const props = defineProps<{
  segment: Segment<TreeNode>
  currentUserId: string
  memberNames?: Record<string, string>
}>()
const emit = defineEmits<{ (e: 'fork', nodeId: string): void }>()

function canFork(n: TreeNode) {
  return n.visibility === 'shared' || n.author_id === props.currentUserId
}
// Top to bottom, oldest first — segment.nodes is already in head→tip chain order.
const forkable = computed(() => props.segment.nodes.filter(canFork))

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function authorName(n: TreeNode) {
  if (n.role === 'assistant') return 'Agent'
  return props.memberNames?.[n.author_id] ?? 'Unknown'
}
function initials(n: TreeNode) {
  return n.role === 'assistant' ? 'AI' : avatarInitials(authorName(n))
}
function avatarStyle(n: TreeNode) {
  return n.role === 'assistant' ? { background: '#e7e4da', color: '#6b6656' } : avatarColors(n.author_id)
}
function oneline(text: string, len = 52) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}
function turnTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function pick(n: TreeNode) {
  emit('fork', n.id)
  open.value = false
}
function toggle() {
  open.value = !open.value
}
function onDocClick(ev: MouseEvent) {
  if (open.value && root.value && !root.value.contains(ev.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div v-if="forkable.length" ref="root" class="forkwrap">
    <button
      class="fork"
      :class="{ active: open }"
      title="Fork a new branch — choose which turn to start from"
      @click.stop="toggle"
    >
      <AppIcon name="code-branch" :size="12" />
      <span>Fork</span>
      <span class="caret">▾</span>
    </button>

    <Transition name="forkpop">
      <div v-if="open" class="forkpop nowheel" @click.stop @wheel.stop>
        <p class="forktitle">Fork from which turn?</p>
        <ul class="forklist">
          <li v-for="n in forkable" :key="n.id">
            <button class="forkitem" @click="pick(n)">
              <span class="favatar" :style="avatarStyle(n)">{{ initials(n) }}</span>
              <span class="fbody">
                <span class="frow">
                  <span class="fauthor">{{ authorName(n) }}</span>
                  <span v-if="n.id === segment.tip.id" class="flatest">Latest</span>
                  <span class="ftime">{{ turnTime(n.created_at) }}</span>
                </span>
                <span class="fsnippet">{{ oneline(n.content) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.forkwrap { position: relative; display: inline-flex; }

.fork {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  padding: 3px 10px 3px 11px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}
.fork:hover, .fork.active { background: var(--accent); color: #fff; }
.caret {
  font-size: 9px;
  line-height: 1;
  transform: translateY(0.5px);
  transition: transform 0.15s ease;
}
.fork.active .caret { transform: rotate(180deg) translateY(-0.5px); }

.forkpop {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 250px;
  max-height: 268px;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(29, 32, 41, 0.18);
  overflow: hidden;
}
.forktitle {
  flex: none;
  margin: 0;
  padding: 9px 12px 7px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.forklist {
  list-style: none;
  margin: 0;
  padding: 5px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.forkitem {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 7px;
  border: 0;
  border-radius: 8px;
  background: none;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 0.12s ease;
}
.forkitem:hover { background: var(--accent-soft); }
.favatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 9.5px;
  font-weight: 700;
}
.fbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.frow { display: flex; align-items: center; gap: 6px; }
.fauthor {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flatest {
  flex: none;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 1px 5px;
}
.ftime { flex: none; margin-left: auto; font-size: 10px; color: var(--muted); }
.fsnippet {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forkpop-enter-active, .forkpop-leave-active { transition: opacity 0.13s ease, transform 0.13s ease; }
.forkpop-enter-from, .forkpop-leave-to { opacity: 0; transform: translateY(4px) scale(0.98); }
</style>
