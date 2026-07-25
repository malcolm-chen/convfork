<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'

const props = defineProps<{
  messages: TreeNode[] // root → tip lineage for the branch being shared
  currentUserId: string
  memberNames?: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'share', uptoId: string | null): void // null = share everything
  (e: 'close'): void
}>()

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
function oneline(text: string, len = 72) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}
function turnTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Click = commit the cutoff (persists until you click another turn); hover =
// live preview of what that cutoff would include, without committing to it.
const selectedId = ref<string | null>(null)
const hoverId = ref<string | null>(null)

const selectedIndex = computed(() => props.messages.findIndex((n) => n.id === selectedId.value))
const hoverIndex = computed(() => (hoverId.value ? props.messages.findIndex((n) => n.id === hoverId.value) : -1))
// Hovering previews a different cutoff than whatever's already selected; once
// the pointer leaves, the committed selection (if any) shows again.
const previewIndex = computed(() => (hoverIndex.value >= 0 ? hoverIndex.value : selectedIndex.value))

function isIncluded(i: number) {
  return previewIndex.value >= 0 && i <= previewIndex.value
}

function selectTurn(n: TreeNode) {
  selectedId.value = n.id
}

const selectedTurn = computed(() =>
  selectedIndex.value >= 0 ? props.messages[selectedIndex.value] : null,
)

function confirmShare() {
  if (!selectedId.value) return
  emit('share', selectedId.value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Share branch">
      <header class="mhead">
        <div>
          <p class="meyebrow">Selective sharing</p>
          <h3>Share this branch</h3>
        </div>
        <button class="mclose" title="Close" @click="emit('close')">✕</button>
      </header>
      <p class="msub">Choose how much of this conversation your team gets to see.</p>

      <button class="shareall" @click="emit('share', null)">
        Share all
        <span class="shareall-sub">Everything in this branch</span>
      </button>

      <p class="mdivider"><span>or pick a turn to share up to</span></p>

      <ul class="turnlist" @mouseleave="hoverId = null">
        <li v-for="(n, i) in messages" :key="n.id">
          <button
            class="turnitem"
            :class="{ included: isIncluded(i), boundary: n.id === selectedId }"
            @mouseenter="hoverId = n.id"
            @click="selectTurn(n)"
          >
            <span class="tavatar" :style="avatarStyle(n)">{{ initials(n) }}</span>
            <span class="tbody">
              <span class="trow">
                <span class="tauthor">{{ authorName(n) }}</span>
                <span v-if="n.visibility === 'shared'" class="ttag">Public</span>
                <span class="ttime">{{ turnTime(n.created_at) }}</span>
              </span>
              <span class="tsnippet">{{ oneline(n.content) }}</span>
            </span>
          </button>
        </li>
      </ul>

      <footer class="mfoot">
        <p class="mfoothint">
          <template v-if="selectedTurn">Sharing from the start through {{ authorName(selectedTurn) }}'s turn at {{ turnTime(selectedTurn.created_at) }}.</template>
          <template v-else>Click a turn above to choose a cutoff.</template>
        </p>
        <button class="confirmbtn" :disabled="!selectedId" @click="confirmShare">Share up to here</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(29, 32, 41, 0.32);
  backdrop-filter: blur(1px);
  animation: fade-in 0.14s ease;
}
@keyframes fade-in { from { opacity: 0; } }

.modal {
  width: 400px;
  max-width: calc(100vw - 48px);
  max-height: min(600px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(29, 32, 41, 0.28);
  padding: 18px 18px 14px;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.7, 0.3, 1);
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
}

.mhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.meyebrow {
  margin: 0 0 2px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.mhead h3 { margin: 0; font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; color: var(--ink); }
.mclose {
  flex: none;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.mclose:hover { background: var(--paper); color: var(--ink); }

.msub { margin: 6px 0 14px; font-size: 12.5px; line-height: 1.4; color: var(--muted); }

.shareall {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 11px 14px;
  border: 0;
  border-radius: 11px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: opacity 0.12s ease;
}
.shareall:hover { opacity: 0.9; }
.shareall-sub { font-size: 11px; font-weight: 500; opacity: 0.85; }

.mdivider {
  position: relative;
  margin: 14px 0 10px;
  text-align: center;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
}
.mdivider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
}
.mdivider span { position: relative; padding: 0 10px; background: var(--card); }

.turnlist {
  list-style: none;
  margin: 0;
  padding: 2px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.turnitem {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: none;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background 0.1s ease;
}
/* Live preview: this turn and everything before it, shaded as "will be shared". */
.turnitem.included { background: var(--accent-soft); }
/* The committed cutoff itself gets a firmer left accent bar. */
.turnitem.boundary { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
.tavatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
}
.tbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.trow { display: flex; align-items: center; gap: 6px; }
.tauthor {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ttag {
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
.ttime { flex: none; margin-left: auto; font-size: 10.5px; color: var(--muted); }
.tsnippet {
  font-size: 12px;
  line-height: 1.35;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mfoot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.mfoothint { flex: 1; min-width: 0; margin: 0; font-size: 11.5px; line-height: 1.35; color: var(--muted); }
.confirmbtn {
  flex: none;
  padding: 8px 16px;
  border: 0;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.12s ease;
}
.confirmbtn:hover:not(:disabled) { opacity: 0.9; }
.confirmbtn:disabled { opacity: 0.4; cursor: default; }
</style>
