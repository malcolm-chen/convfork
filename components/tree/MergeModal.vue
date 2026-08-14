<script setup lang="ts">
// "Create Merged Node" modal: AI-generated (editable) title/summary over the
// selected conversation nodes (segments), a removable source list, and
// Cancel/Create actions. Generation re-runs automatically when a source is
// removed — there's no manual regenerate control.

export interface MergeSource {
  headNodeId: string
  tipNodeId: string
  label: string
  authorId: string
  turnCount: number
}

const props = defineProps<{
  conversationId: string
  sources: MergeSource[]
  memberNames: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'created', result: { id: string; title: string; summary: string }): void
  (e: 'cancel'): void
}>()

const activeSources = ref<MergeSource[]>([...props.sources])
const title = ref('')
const summary = ref('')
const generating = ref(false)
const genError = ref<string | null>(null)
const creating = ref(false)
const createError = ref<string | null>(null)

function segmentPayload() {
  return activeSources.value.map((s) => ({ headNodeId: s.headNodeId, tipNodeId: s.tipNodeId }))
}

async function generate() {
  if (activeSources.value.length < 2) return
  generating.value = true
  genError.value = null
  try {
    const res = await $fetch<{ title: string; summary: string }>('/api/merge/generate', {
      method: 'POST',
      body: { conversationId: props.conversationId, segments: segmentPayload() },
    })
    title.value = res.title
    summary.value = res.summary
  } catch (err: any) {
    genError.value = err?.data?.statusMessage || err?.message || 'Could not generate a title/summary.'
  } finally {
    generating.value = false
  }
}

function removeSource(headNodeId: string) {
  activeSources.value = activeSources.value.filter((s) => s.headNodeId !== headNodeId)
  if (activeSources.value.length >= 2) generate()
}

const canCreate = computed(
  () => !!title.value.trim() && activeSources.value.length >= 2 && !creating.value && !generating.value,
)

async function create() {
  if (!canCreate.value) return
  // The merged node has no privacy control of its own (see mcn_select RLS) —
  // once created it's visible to the whole team, unlike its sources, which
  // are only mergeable in the first place because their author already chose
  // to share them. Confirm before taking that step for them.
  const ok = confirm(
    `“${title.value.trim()}” will be visible to your whole team once created. Continue?`,
  )
  if (!ok) return
  creating.value = true
  createError.value = null
  try {
    const res = await $fetch<{ id: string; title: string; summary: string }>('/api/merge/create', {
      method: 'POST',
      body: {
        conversationId: props.conversationId,
        title: title.value.trim(),
        summary: summary.value.trim(),
        segments: segmentPayload(),
      },
    })
    emit('created', res)
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || err?.message || 'Could not create the merged node.'
  } finally {
    creating.value = false
  }
}

function authorName(id: string) {
  return props.memberNames[id] ?? 'Unknown'
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  generate()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Create Merged Node">
      <h3 class="dtitle">Create Merged Node</h3>

      <label class="flabel" for="merge-title">Title</label>
      <input
        id="merge-title"
        v-model="title"
        class="finput"
        :class="{ shimmer: generating }"
        :placeholder="generating ? 'Generating a title' : 'Untitled merge'"
        maxlength="80"
      />

      <label class="flabel" for="merge-summary">Summary</label>
      <textarea
        id="merge-summary"
        v-model="summary"
        class="ftextarea"
        :class="{ shimmer: generating }"
        :placeholder="generating ? 'Generating a summary' : 'Describe what these conversation nodes have in common.'"
        rows="3"
        maxlength="500"
      />
      <p v-if="genError" class="err">⚠️ {{ genError }}</p>

      <p class="navlabel">Selected conversation nodes</p>
      <ul class="srclist">
        <li v-for="s in activeSources" :key="s.headNodeId" class="srow">
          <UiAvatar class="savatar" :name="authorName(s.authorId)" :color-key="s.authorId" :size="24" />
          <div class="smeta">
            <p class="stitlerow">{{ s.label }}</p>
            <p class="ssub">{{ authorName(s.authorId) }} ({{ s.turnCount }} turn{{ s.turnCount === 1 ? '' : 's' }})</p>
          </div>
          <button
            class="sremove"
            type="button"
            :disabled="activeSources.length <= 2"
            :title="activeSources.length <= 2 ? 'A merge needs at least 2 conversation nodes' : 'Remove'"
            @click="removeSource(s.headNodeId)"
          >
            <AppIcon name="x" :size="12" />
          </button>
        </li>
      </ul>
      <p v-if="createError" class="err">⚠️ {{ createError }}</p>

      <div class="dactions">
        <UiButton variant="ghost" :disabled="creating" @click="emit('cancel')">Cancel</UiButton>
        <UiButton variant="primary" :disabled="!canCreate" @click="create">
          {{ creating ? 'Creating…' : 'Create' }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 20, 30, 0.38);
  backdrop-filter: blur(1px);
  animation: fade-in 0.14s ease;
}
@keyframes fade-in { from { opacity: 0; } }

.dialog {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  background: var(--card);
  border-radius: 22px;
  box-shadow: 0 24px 64px rgba(20, 20, 30, 0.28);
  padding: 30px 30px 26px;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.7, 0.3, 1);
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
}

.dtitle { margin: 0 0 20px; font-size: 22px; font-weight: 700; color: var(--ink); }

/* Same flowing pulse as the canvas card's "Summarizing…" state (TreeNode.vue),
   applied to the placeholder itself so "Generating a title/summary" shimmers
   right inside the field instead of needing a separate status line. */
@keyframes pulse { 50% { opacity: 0.4; } }
.shimmer::placeholder { animation: pulse 1.2s ease-in-out infinite; }

.flabel {
  display: block;
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.finput, .ftextarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  margin-bottom: 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  resize: vertical;
}
.finput::placeholder, .ftextarea::placeholder { color: var(--muted); }
.finput:focus, .ftextarea:focus { outline: none; border-color: var(--accent); }

.navlabel {
  margin: 4px 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
.srclist { list-style: none; margin: 0 0 4px; padding: 0; max-height: 220px; overflow-y: auto; }
.srow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--line);
}
.srow:last-child { border-bottom: 0; }
.smeta { flex: 1; min-width: 0; }
.stitlerow {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssub { margin: 2px 0 0; font-size: 11.5px; color: var(--muted); }
.sremove {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.sremove:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
.sremove:disabled { opacity: 0.35; cursor: default; }

.err { margin: 4px 0 12px; color: var(--danger); font-size: 12.5px; }

.dactions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
