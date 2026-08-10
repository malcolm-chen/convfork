<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'

// Anchored popover (not a modal — no backdrop dimming) for the "Share
// branch" button: share everything in one click, or hand-pick which of your
// own currently-private turns on this branch actually go public.
const props = defineProps<{
  nodes: TreeNode[] // currently-private own nodes on this branch, oldest → newest
  memberNames: Record<string, string>
  busy?: boolean
}>()
const emit = defineEmits<{
  (e: 'share-all'): void
  (e: 'confirm', ids: string[]): void
  (e: 'cancel'): void
}>()

// Defaults to everything selected — "Confirm" with no changes behaves the
// same as "Share all", the picker is purely for narrowing that down.
const selected = ref<Set<string>>(new Set(props.nodes.map((n) => n.id)))
watch(
  () => props.nodes.map((n) => n.id).join(','),
  () => { selected.value = new Set(props.nodes.map((n) => n.id)) },
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function oneline(text: string, len = 46) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}

function onConfirm() {
  if (!selected.value.size) return
  emit('confirm', [...selected.value])
}

const root = ref<HTMLElement | null>(null)
function onDocClick(ev: MouseEvent) {
  if (root.value && !root.value.contains(ev.target as Node)) emit('cancel')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="sharepop" role="dialog" aria-modal="true" aria-label="Share this branch" @click.stop>
    <span class="pointer" />
    <h3 class="stitle">Share this branch</h3>

    <UiButton variant="primary" class="allbtn" :disabled="busy" @click="emit('share-all')">
      {{ busy ? 'Sharing…' : 'Share all' }}
    </UiButton>

    <div class="divider"><span>Or select the turns you want to share</span></div>

    <ul class="turnpicker nowheel">
      <li v-for="n in nodes" :key="n.id" class="prow" @click="toggle(n.id)">
        <span class="check" :class="{ on: selected.has(n.id) }">
          <AppIcon v-if="selected.has(n.id)" name="check" :size="10" />
        </span>
        <span v-if="n.role === 'assistant'" class="pavatar ai">AI</span>
        <UiAvatar v-else class="pavatar" :name="memberNames[n.author_id] ?? '?'" :color-key="n.author_id" :size="20" />
        <span class="psnippet">{{ oneline(n.content) }}</span>
      </li>
      <li v-if="!nodes.length" class="pempty">Nothing left to share — this branch is already fully public.</li>
    </ul>

    <div class="pactions">
      <UiButton variant="ghost" :disabled="busy" @click="emit('cancel')">Cancel</UiButton>
      <UiButton variant="primary" :disabled="busy || !selected.size" @click="onConfirm">
        {{ busy ? 'Working…' : 'Confirm' }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.sharepop {
  position: absolute;
  top: calc(100% + 14px);
  right: 0;
  z-index: 60;
  width: 320px;
  max-width: calc(100vw - 32px);
  padding: 22px 22px 18px;
  background: var(--card);
  border-radius: 20px;
  box-shadow: 0 24px 64px rgba(20, 20, 30, 0.24);
  animation: pop-in 0.14s cubic-bezier(0.2, 0.7, 0.3, 1);
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
}
.pointer {
  position: absolute;
  top: -8px;
  right: 28px;
  width: 16px;
  height: 16px;
  background: var(--card);
  transform: rotate(45deg);
  border-radius: 3px 0 0 0;
}

.stitle {
  margin: 0 0 16px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}

.allbtn { display: flex; width: 100%; justify-content: center; padding: 11px; border-radius: 12px; font-size: 14px; }

.divider {
  position: relative;
  display: flex;
  justify-content: center;
  margin: 18px 0 12px;
}
.divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
}
.divider span {
  position: relative;
  padding: 0 10px;
  background: var(--card);
  font-size: 11px;
  color: var(--muted);
}

.turnpicker {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--line);
}
.prow:last-child { border-bottom: 0; }
.prow:hover { background: var(--accent-soft); }

.check {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  color: #fff;
  transition: background 0.1s ease, border-color 0.1s ease;
}
.check.on { background: var(--accent); border-color: var(--accent); }

.pavatar { flex: none; }
.pavatar.ai {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--ink);
  color: var(--paper);
  font-size: 8px;
  font-weight: 700;
}
.psnippet {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pempty { padding: 16px 10px; text-align: center; font-size: 12px; color: var(--muted); }

.pactions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
</style>
