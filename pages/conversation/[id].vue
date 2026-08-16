<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import type { AttachmentRef } from '~/composables/useFileUpload'
import type { ConceptTag } from '~/composables/useConcepts'
import { segmentize, sharedOrder, sharedSegments, turnNumberOf } from '~/composables/useSegments'
import { DEFAULT_MODEL_ID } from '#shared/models'

// Without this, navigating between two conversation pages (e.g. forking,
// which lands you on `/conversation/<new-id>`) reuses this component instance
// instead of remounting — Vue Router's default behavior for two routes that
// match the same dynamic route record. `conversationId` below is captured
// once at setup and everything derived from it (useConversation, useRealtime,
// onMounted) would otherwise stay bound to whichever conversation was open
// first. Keying by the full path forces a genuine remount per conversation.
definePageMeta({ key: (route) => route.fullPath })

const route = useRoute()
const conversationId = route.params.id as string
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const logger = useActionLogger()

const conv = useConversation(conversationId)
const rt = useRealtime(conversationId, conv)
const { streamingText, streamingReasoning, isStreaming, error, send } = useLLMStream()
// The model backbone the in-flight reply is using — known synchronously at
// submit time, well before any node carrying it is persisted.
const streamingModel = ref<string | null>(null)

const nodes = conv.nodes
const reactionsByNode = conv.reactionsByNode
const attachmentsByNode = conv.attachmentsByNode
// Aliased to a top-level binding (matching the pattern above) so the
// template's ref-unwrapping actually applies — `rt.presenceBySegment` inside
// a template expression would otherwise hand the ComputedRef object itself
// to ReasoningTree instead of its unwrapped Map.
const presenceBySegment = rt.presenceBySegment
const selectedId = ref<string | null>(null)
// Set when the user explicitly forks: the chat panel then renders everything
// up to this node as prior history, with a divider before the new branch.
const forkPointId = ref<string | null>(null)
// True after "New chat" until the first message (or selecting an existing chat).
const drafting = ref(false)

// Persistent "draft forks": a fork the user started (picked a turn to fork
// from) but hasn't sent a message in yet. There are no DB nodes for it until
// the first message, so it's kept in localStorage per conversation — it
// survives switching to another chat/project and page reloads, and only goes
// away when the user sends its first message (it becomes a real branch) or
// explicitly deletes it.
interface DraftFork { key: string; forkFromNodeId: string; createdAt: string }
const draftForks = ref<DraftFork[]>([])
const activeDraftKey = ref<string | null>(null)
const DRAFTS_KEY = `convfork:draftForks:${conversationId}`
const currentUserId = computed(() => user.value?.id ?? '')
const messages = computed(() => (drafting.value ? [] : conv.lineageOf(selectedId.value)))

// Teammate presence: "someone is chatting here" avatars on the canvas — see
// usePresenceActivity.ts for what counts as active and the privacy filter.
const presenceActivity = usePresenceActivity({
  nodes,
  selectedId,
  drafting,
  isStreaming,
  currentUserId,
  trackPresence: rt.trackPresence,
  untrackPresence: rt.untrackPresence,
})

// The single user message (if any) an "Edit" button may appear on: your own,
// last-in-branch, and not already forked below — anything else makes "revert
// and regenerate" ambiguous about what exactly should be discarded. Shown
// even while the reply is still streaming in (its node doesn't exist in
// conv yet, so it simply isn't counted as a child below) — ThreadPanel just
// disables the actual Send button until isStreaming clears, so opening the
// editor to compose an edit doesn't have to wait on the in-flight reply.
const editableUserNodeId = computed(() => {
  const msgs = messages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'user') continue
    if (m.author_id !== currentUserId.value) return null
    const children = conv.childrenOf(m.id)
    if (children.length > 1) return null
    const onlyChild = children[0]
    if (onlyChild && conv.childrenOf(onlyChild.id).length > 0) return null
    return m.id
  }
  return null
})

// ── Merge mode: select 2+ conversation nodes (segments) on this project's
// canvas, generate a merged node over them. See composables/useMergeMode.ts. ──
const mergeMode = useMergeMode()
const mergedNodesStore = useMergedNodes(conversationId)
const conceptsStore = useConcepts(conversationId)
const showMergeModal = ref(false)
const canContinueMerge = computed(() => mergeMode.state.selectedIds.size >= 2)

function onToggleMergeSelect(segmentId: string) {
  mergeMode.toggle(segmentId)
}
function openMergeModal() {
  if (canContinueMerge.value) showMergeModal.value = true
}
function cancelMergeModal() {
  showMergeModal.value = false
}
const modalSources = computed(() => {
  const segs = segmentize(nodes.value)
  return [...mergeMode.state.selectedIds].map((headId) => {
    const seg = segs.find((s) => s.id === headId)
    const starter = seg?.nodes.find((n) => n.role === 'user') ?? seg?.head
    return {
      headNodeId: headId,
      tipNodeId: seg?.tip.id ?? headId,
      label: snippet(starter?.content ?? '', 60) || 'Untitled',
      authorId: starter?.author_id ?? '',
      turnCount: seg?.nodes.length ?? 0,
    }
  })
})
async function onMergeCreated() {
  showMergeModal.value = false
  mergeMode.cancel()
  await mergedNodesStore.refresh()
}

// ── Merge-fork draft: a chat seeded from a merged node's inherited context.
// Like draftForks above, no DB node exists until the first message — but this
// new segment has no parent at all (parent_id null, a fresh root within this
// same project) rather than forking from a specific existing turn.
const activeMergedNodeId = ref<string | null>(null)
function activateMergeDraft(mergedNodeId: string) {
  // Same "drafting" state as New chat — there's no existing node to select,
  // just one composer ready to go — so the thread panel shows "send a
  // message to continue" instead of the "select a chat from the list" empty
  // state meant for when nothing at all is active.
  error.value = null // a failed send in a previous chat shouldn't bleed into this one
  drafting.value = true
  selectedId.value = null
  forkPointId.value = null
  activeDraftKey.value = null
  activeMergedNodeId.value = mergedNodeId
}

// Whichever merged node is driving the inherited-context block right now —
// the active pre-send draft, or (once the segment's root node is real) that
// node's own parent_merged_node_id, looked up the same way server-side in
// server/utils/lineage.ts.
const effectiveMergedNodeId = computed(
  () => activeMergedNodeId.value || messages.value[0]?.parent_merged_node_id || null,
)
interface InheritedSource {
  segmentHeadNodeId: string
  authorId: string
  label: string
  messages: { id: string; role: 'user' | 'assistant'; authorName: string; content: string; created_at: string }[]
}
const inheritedGroups = ref<InheritedSource[]>([])
// Guards against a stale response: e.g. the user opens a merge-forked chat,
// then clicks "New Chat" before that fetch resolves. Without this, the old
// fetch can land after the switch and repopulate inheritedGroups with the
// previous chat's merge data.
let inheritedGroupsRequestSeq = 0
watch(
  effectiveMergedNodeId,
  async (id) => {
    const requestSeq = ++inheritedGroupsRequestSeq
    if (!id) {
      inheritedGroups.value = []
      return
    }
    try {
      const sources = (await $fetch<{ sources: InheritedSource[] }>(`/api/merge/${id}`)).sources
      if (requestSeq === inheritedGroupsRequestSeq) inheritedGroups.value = sources
    } catch {
      if (requestSeq === inheritedGroupsRequestSeq) inheritedGroups.value = []
    }
  },
  { immediate: true },
)

// ── Resizable chat/tree split (both flex, equal by default) ──
// splitRatio is the tree panel's share of the chat+tree space; the chat panel
// always gets the rest, so they're equal width (0.5/0.5) until dragged.
const SPLIT_KEY = 'convfork:panelSplitRatio'
const SPLIT_DEFAULT = 0.5
const SPLIT_MIN_PX = 320 // neither panel should get narrower than this
const splitRatio = ref(SPLIT_DEFAULT)
const resizing = ref(false)

function clampSplitRatio(r: number) {
  const available = Math.max(1, window.innerWidth - 236)
  const min = Math.min(0.5, SPLIT_MIN_PX / available)
  return Math.min(1 - min, Math.max(min, r))
}

function onSplitterDown(e: PointerEvent) {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startRatio = splitRatio.value
  const available = Math.max(1, window.innerWidth - 236)

  const onMove = (ev: PointerEvent) => {
    // The splitter sits on the tree panel's left edge — dragging it leftward widens the tree.
    splitRatio.value = clampSplitRatio(startRatio + (startX - ev.clientX) / available)
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    try {
      localStorage.setItem(SPLIT_KEY, String(splitRatio.value))
    } catch { /* ignore */ }
    // Let Vue Flow / canvas remeasure its pane.
    window.dispatchEvent(new Event('resize'))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

// Only MY OWN chats (a root I started, or a branch I forked) — a teammate's
// shared work shouldn't auto-open in, or default into, someone else's window
// just because it's visible; it only becomes "my chat" once I fork it.
function mostRecentChatTip(list: TreeNode[], authorId: string): string | null {
  const chats = segmentize(list)
    .filter((s) => s.head.author_id === authorId && (!s.parentId || s.head.is_fork_point))
    .sort((a, b) => b.tip.created_at.localeCompare(a.tip.created_at))
  return chats[0]?.tip.id ?? null
}

// ── SideNav data (profile, team, members, project list) ──
const { data: profile } = await useAsyncData(`conv:profile`, async () => {
  if (!user.value) return null
  const { data } = await supabase
    .from('users')
    .select('display_name, team_id, role')
    .eq('id', user.value.id)
    .single()
  return data
})

const { data: team } = await useAsyncData('conv:team', async () => {
  if (!profile.value?.team_id) return null
  const { data } = await supabase
    .from('teams')
    .select('name, sharing_condition')
    .eq('id', profile.value.team_id)
    .single()
  return data
})

const selectiveSharing = computed(() => team.value?.sharing_condition === 'selective_sharing')
// Solo condition: no team panel, no canvas, no sharing — just the middle
// conversation window (chat history + thread + composer).
const individualLlm = computed(() => team.value?.sharing_condition === 'individual_llm')

interface Member { id: string; display_name: string; role: string | null }
const { data: members } = await useAsyncData('conv:members', async () => {
  if (!profile.value?.team_id) return [] as Member[]
  const { data } = await supabase
    .from('users')
    .select('id, display_name, role')
    .eq('team_id', profile.value.team_id)
    .order('display_name')
  return (data ?? []) as Member[]
})

// Team-wide online status for the SideNav member list — separate from the
// per-conversation "chatting on this node" presence above, and not started
// for the individual_llm condition (no team panel/concept there at all).
const teamPresence = useTeamPresence(profile.value?.team_id ?? '')
// See the identical note on presenceBySegment above re: template unwrapping.
const onlineIds = teamPresence.onlineIds

const { data: convos, refresh: refreshConvos } = await useAsyncData('conv:list', async () => {
  if (!profile.value?.team_id) return []
  // Embed each conversation's latest visible node (RLS-scoped) so projects
  // sort by most recent activity, falling back to creation time. The embed
  // names the FK (nodes!nodes_conversation_id_fkey) explicitly to be
  // unambiguous about which conversations<->nodes relationship to follow.
  const { data } = await supabase
    .from('conversations')
    .select('id, title, created_at, nodes!nodes_conversation_id_fkey(created_at)')
    .order('created_at', { referencedTable: 'nodes', ascending: false })
    .limit(1, { referencedTable: 'nodes' })
  return (data ?? [])
    .map((c: any) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      updatedAt: c.nodes?.[0]?.created_at ?? c.created_at,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
})

// A teammate creating a project elsewhere shouldn't require leaving this page
// (or refreshing) for it to show up in the sidebar's project list.
const conversationsRt = useConversationsRealtime(refreshConvos)

const convo = computed(() => (convos.value as any[])?.find((c) => c.id === conversationId))

const memberNames = computed(() =>
  Object.fromEntries((members.value ?? []).map((m) => [m.id, m.display_name])),
)

// ── Tree meta for the header ──
function pad(n: number) {
  return String(n).padStart(2, '0')
}

const lastUpdateLabel = computed(() => {
  const latest = nodes.value.reduce((max, n) => (n.created_at > max ? n.created_at : max), convo.value?.created_at ?? '')
  if (!latest) return '—'
  const d = new Date(latest)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

const contributorAvatars = computed(() => {
  const seen = new Set<string>()
  const list: { id: string; name: string }[] = []
  for (const n of nodes.value) {
    if (seen.has(n.author_id)) continue
    seen.add(n.author_id)
    list.push({ id: n.author_id, name: memberNames.value[n.author_id] ?? '?' })
  }
  return list
})

// ── Canvas filter bar: highlight segments/merged nodes by author or topic.
// Only one filter dimension is active at a time — picking one clears the other. ──
const filterAuthorId = ref<string | null>(null)
const filterConceptId = ref<string | null>(null)
function onFilterAuthorId(id: string | null) {
  filterAuthorId.value = id
  if (id) filterConceptId.value = null
}
function onFilterConceptId(id: string | null) {
  filterConceptId.value = id
  if (id) filterAuthorId.value = null
}
// Only concepts actually attached to a currently-rendered segment — not the
// whole project's historical registry, which could include concepts no
// longer attached to anything visible (see design plan §13).
const availableTopics = computed(() => {
  const seen = new Set<string>()
  const list: ConceptTag[] = []
  for (const tags of conceptsStore.bySegment.values()) {
    for (const t of tags) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      list.push(t)
    }
  }
  return list
})
// Every card on the canvas emits this on mount — collect them into one
// batch instead of firing a separate request per card, so a cold-open
// canvas tags everything missing in a single combined LLM call rather than
// a burst of concurrent per-segment ones.
let conceptBatch: { segmentHeadNodeId: string; tipNodeId: string }[] = []
let conceptBatchTimer: ReturnType<typeof setTimeout> | null = null
function onRequestConcepts(payload: { segmentHeadNodeId: string; tipNodeId: string; model?: string | null }) {
  conceptBatch.push({ segmentHeadNodeId: payload.segmentHeadNodeId, tipNodeId: payload.tipNodeId })
  if (conceptBatchTimer) clearTimeout(conceptBatchTimer)
  conceptBatchTimer = setTimeout(() => {
    const batch = conceptBatch
    conceptBatch = []
    conceptBatchTimer = null
    conceptsStore.requestMany(batch)
  }, 200)
}

function snippet(text: string, len = 44) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean
}

// Branch title: the message that started the current branch — the last
// fork-point node on the path, else the first user message, else the title.
const branchTitle = computed(() => {
  const path = messages.value
  if (!path.length) return convo.value?.title || 'Conversation'
  let start = 0
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].is_fork_point) { start = i; break }
  }
  const anchor = path.slice(start).find((n) => n.role === 'user') ?? path[start]
  return snippet(anchor.content) || 'Untitled branch'
})

// The node the current branch was forked from: while actively forking, that's
// the node under the composer (forkPointId); for an already-created fork chat,
// it's the parent of the branch's fork-point node — the last is_fork_point on
// the path to the selected turn.
const forkOriginNodeId = computed<string | null>(() => {
  if (forkPointId.value) return forkPointId.value
  const path = messages.value
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]!.is_fork_point) return path[i]!.parent_id
  }
  return null
})

// "Forked from C1-2" — the origin segment's shared-order badge plus the 1-based
// position of the exact turn that was forked within it. Null (label hidden) if
// the origin segment was never shared, since the C-numbering only covers shared
// segments.
const forkOriginLabel = computed(() => {
  const originId = forkOriginNodeId.value
  if (!originId) return null
  const segs = segmentize(nodes.value)
  const origin = segs.find((s) => s.nodes.some((n) => n.id === originId))
  if (!origin) return null
  const idx = sharedOrder(segs).get(origin.id)
  if (idx == null) return null
  return `C${idx}-${turnNumberOf(origin, originId)}`
})

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(saved) && saved > 0) splitRatio.value = clampSplitRatio(saved)
  } catch { /* ignore */ }

  // Belt-and-suspenders alongside the definePageMeta key above: force a fresh
  // fetch rather than trusting Nuxt's cross-navigation useAsyncData cache for
  // this key, so a newly created project shows up immediately in the list.
  await refreshConvos()

  await conv.load()
  rt.start()
  if (!individualLlm.value) teamPresence.start()
  conversationsRt.start(profile.value?.team_id ?? '')
  await mergedNodesStore.refresh()
  await conceptsStore.refresh()
  loadDraftForks()
  pruneDraftForks()
  // ChatGPT-style: open the most recent chat, or start drafting if none exist.
  const tip = mostRecentChatTip(nodes.value, currentUserId.value)
  if (tip) selectedId.value = tip
  else drafting.value = true
})
onBeforeUnmount(() => {
  rt.stop()
  teamPresence.stop()
  conversationsRt.stop()
  logger.flush()
})

function select(id: string) {
  logger.log('select_branch', { node_id: id, from_node_id: selectedId.value }, { conversationId, nodeId: id })
  error.value = null // a failed send in a previous chat shouldn't bleed into this one
  drafting.value = false
  activeDraftKey.value = null // leaving a draft fork just deselects it; it stays in the list
  if (id !== forkPointId.value) forkPointId.value = null // navigating away ends fork mode
  selectedId.value = id
  activeMergedNodeId.value = null
}

function startNewChat() {
  logger.log('new_chat', {}, { conversationId })
  error.value = null // a failed send in a previous chat shouldn't bleed into this one
  selectedId.value = null
  forkPointId.value = null
  activeDraftKey.value = null
  activeMergedNodeId.value = null
  drafting.value = true
}

async function onSubmit(payload: { text: string; model: string; thinking?: string; attachments?: AttachmentRef[] }) {
  const parentNodeId = drafting.value ? null : selectedId.value
  // True only for the first message right after clicking Fork (selectedId is
  // still sitting on the fork point) — tells the server to start a brand new
  // branch here instead of leaving it to (unreliable) sibling-count inference.
  const isFork = !!forkPointId.value && parentNodeId === forkPointId.value
  const materializedDraft = activeDraftKey.value
  const materializedMergeDraft = !parentNodeId ? activeMergedNodeId.value : null
  streamingModel.value = payload.model
  const r = await send({
    conversationId,
    parentNodeId,
    userText: payload.text,
    model: payload.model,
    thinking: payload.thinking,
    attachments: payload.attachments,
    isFork,
    mergedNodeId: materializedMergeDraft ?? undefined,
    // Render the user's own turn the instant we know its id, rather than
    // waiting on the full SSE stream + fetchLineage below — otherwise the
    // message the user just sent doesn't appear until the agent starts
    // replying, which reads as if it never sent.
    onUserNodeId: (userNodeId) => {
      conv.upsert({
        id: userNodeId,
        conversation_id: conversationId,
        parent_id: parentNodeId,
        author_id: currentUserId.value,
        role: 'user',
        content: payload.text,
        reasoning: null,
        visibility: 'private',
        is_fork_point: isFork,
        model: null,
        parent_merged_node_id: materializedMergeDraft,
        created_at: new Date().toISOString(),
        title: null,
        title_manual: false,
        title_hash: null,
      })
      for (const a of payload.attachments ?? []) {
        conv.addAttachment({
          id: `optimistic:${a.key}`,
          node_id: userNodeId,
          filename: a.filename,
          content_type: a.contentType,
          size_bytes: a.size,
          kind: a.kind,
          created_at: new Date().toISOString(),
        })
      }
      drafting.value = false
      selectedId.value = userNodeId
      // The draft fork just became a real branch the instant we know its id —
      // don't wait on the AI's reply to graduate it out of "draft" in the
      // sidebar (activeDraftKey gates ChatSidebar's active-row highlighting).
      if (materializedDraft) removeDraftFork(materializedDraft)
      refreshConvos() // bump this project to the top of the activity-ordered list
    },
  })
  // Superseded by an edit to this very message while it was still streaming
  // (useLLMStream aborts the older send() — see its comment) — that edit's
  // own tail already owns selectedId/fetchLineage for the replacement node,
  // so there's nothing left here to finish.
  if (!conv.nodesById.has(r.userNodeId)) return
  // Pull the new pair immediately — selecting before the realtime INSERT
  // arrives would otherwise blank the thread panel for a beat. This also
  // overwrites the optimistic user node above with the server-confirmed one.
  await conv.fetchLineage(r.assistantNodeId)
  // The merge-fork draft just became a real segment — the new root node now
  // carries parent_merged_node_id itself, so effectiveMergedNodeId keeps
  // resolving correctly without this ref.
  if (materializedMergeDraft) activeMergedNodeId.value = null
  drafting.value = false
  selectedId.value = r.assistantNodeId
}

// Edit a past user message (ThreadPanel's Edit button, gated to
// editableUserNodeId above): the old message + the AI reply it produced
// (nodes are immutable, so this can never be an UPDATE — see chat.post.ts)
// are purged server-side and a fresh turn is generated from the same parent.
async function onEditMessage(payload: { id: string; text: string }) {
  const node = conv.nodesById.get(payload.id)
  const text = payload.text.trim()
  if (!node || node.role !== 'user' || node.author_id !== currentUserId.value || !text) return

  const children = conv.childrenOf(node.id)
  if (children.length > 1) return // multiple branches already exist; ambiguous what to discard
  const assistantChild = children[0]
  if (assistantChild && conv.childrenOf(assistantChild.id).length > 0) return // reply has its own follow-ups

  const parentNodeId = node.parent_id
  const model = assistantChild?.model ?? DEFAULT_MODEL_ID
  const idsToDelete = assistantChild ? [node.id, assistantChild.id] : [node.id]

  logger.log('edit_message', { node_id: node.id, len: text.length }, { conversationId, nodeId: node.id })
  streamingModel.value = model
  const r = await send({
    conversationId,
    parentNodeId,
    userText: text,
    model,
    editNodeId: node.id,
    onUserNodeId: (userNodeId) => {
      conv.removeNodes(idsToDelete)
      conv.upsert({
        id: userNodeId,
        conversation_id: conversationId,
        parent_id: parentNodeId,
        author_id: currentUserId.value,
        role: 'user',
        content: text,
        reasoning: null,
        visibility: 'private',
        is_fork_point: node.is_fork_point,
        model: null,
        parent_merged_node_id: node.parent_merged_node_id,
        created_at: new Date().toISOString(),
        title: null,
        title_manual: false,
        title_hash: null,
      })
      selectedId.value = userNodeId
    },
  })
  // Superseded by yet another edit before this one's round trip finished —
  // its tail already owns selectedId/fetchLineage (see onSubmit's identical
  // guard for the fuller explanation).
  if (!conv.nodesById.has(r.userNodeId)) return
  await conv.fetchLineage(r.assistantNodeId)
  selectedId.value = r.assistantNodeId
}

// ── Draft forks (persisted; see the declaration near the top) ──
function loadDraftForks() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    draftForks.value = raw ? (JSON.parse(raw) as DraftFork[]) : []
  } catch { draftForks.value = [] }
}
function persistDraftForks() {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftForks.value)) } catch { /* ignore */ }
}
// Drop drafts whose origin turn no longer exists (e.g. the tree was cleared).
function pruneDraftForks() {
  const before = draftForks.value.length
  draftForks.value = draftForks.value.filter((d) => nodes.value.some((n) => n.id === d.forkFromNodeId))
  if (draftForks.value.length !== before) persistDraftForks()
}
function activateDraftFork(key: string, forkFromNodeId: string) {
  error.value = null // a failed send in a previous chat shouldn't bleed into this one
  drafting.value = false
  activeDraftKey.value = key
  forkPointId.value = forkFromNodeId // thread shows history up to here + fork divider
  selectedId.value = forkFromNodeId // composer targets this node as parent
  activeMergedNodeId.value = null
}
function selectDraftFork(key: string) {
  const d = draftForks.value.find((x) => x.key === key)
  if (!d) return
  logger.log('select_branch', { node_id: d.forkFromNodeId, from_node_id: selectedId.value, draft_fork: true }, { conversationId, nodeId: d.forkFromNodeId })
  activateDraftFork(key, d.forkFromNodeId)
}
function removeDraftFork(key: string) {
  draftForks.value = draftForks.value.filter((d) => d.key !== key)
  persistDraftForks()
  if (activeDraftKey.value === key) activeDraftKey.value = null
}
// User explicitly deletes a draft fork from the chat list.
function deleteDraftFork(key: string) {
  logger.log('delete_draft_fork', {}, { conversationId })
  const wasActive = activeDraftKey.value === key
  removeDraftFork(key)
  if (wasActive) {
    error.value = null // a failed send in the deleted draft shouldn't bleed into the next chat
    forkPointId.value = null
    const tip = mostRecentChatTip(nodes.value, currentUserId.value)
    if (tip) { selectedId.value = tip; drafting.value = false }
    else { selectedId.value = null; drafting.value = true }
  }
}

const pendingForkId = ref<string | null>(null)
function onFork(id: string) {
  pendingForkId.value = id
}
function cancelFork() {
  pendingForkId.value = null
}
// Forking branches THIS conversation's tree — a new "chat" entry in Chat
// History, not a new project. No DB node is written yet: we record a persistent
// draft fork (localStorage) pointing at the chosen turn and activate it. The
// fork-point node itself is created the normal way when the user sends the
// first message (see onSubmit's isFork flag), at which point the draft is
// dropped in favor of the real branch.
function confirmFork() {
  const id = pendingForkId.value
  pendingForkId.value = null
  if (!id) return
  logger.log('fork', { from_node_id: id }, { conversationId, nodeId: id })
  const key = crypto.randomUUID()
  draftForks.value = [{ key, forkFromNodeId: id, createdAt: new Date().toISOString() }, ...draftForks.value]
  persistDraftForks()
  activateDraftFork(key, id)
}

// Forking a merged node: like confirmFork above, but the new segment has no
// origin turn at all — it's a fresh root within this project, seeded with
// the merged node's inherited context (see activateMergeDraft).
function onForkMerge(mergedNodeId: string) {
  logger.log('merge_fork', { merged_node_id: mergedNodeId }, { conversationId })
  activateMergeDraft(mergedNodeId)
}

// Only the merge's own author gets the delete control at all (server
// re-checks this too) — but forks of it may already have real turns in
// them, possibly by other people, so warn before erasing those along with it.
async function onDeleteMerge(mergedNodeId: string) {
  const hasForks = nodes.value.some((n) => n.parent_merged_node_id === mergedNodeId)
  const ok = confirm(
    hasForks
      ? 'This merge has been forked into a conversation node. Deleting it will also permanently erase that conversation node (and anything built on it since). Continue?'
      : 'Delete this merged node? This cannot be undone.',
  )
  if (!ok) return
  logger.log('merge_delete', { merged_node_id: mergedNodeId }, { conversationId })
  try {
    await $fetch('/api/merge/delete', { method: 'POST', body: { mergedNodeId } })
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Could not delete the merged node — please retry.')
    return
  }
  await mergedNodesStore.refresh()
  await conv.load() // pick up any forked segments the delete erased
}

async function onReact(payload: { nodeId: string; type: string }) {
  const row = {
    id: crypto.randomUUID(),
    node_id: payload.nodeId,
    user_id: user.value!.id,
    type: payload.type,
    created_at: new Date().toISOString(),
  }
  logger.log('react', { node_id: payload.nodeId, type: payload.type }, { conversationId, nodeId: payload.nodeId })
  const { error } = await supabase.from('reactions').upsert(
    { id: row.id, node_id: row.node_id, user_id: row.user_id, type: row.type },
    { onConflict: 'node_id,user_id,type', ignoreDuplicates: true },
  )
  if (!error) conv.addReaction(row)
}

// Toggle-off: remove the caller's own reaction (emoji or 📌 pin). The bar
// emits this when the current user re-clicks an emoji they already left.
async function onUnreact(payload: { id: string; nodeId: string; type: string }) {
  logger.log('unreact', { node_id: payload.nodeId, type: payload.type }, { conversationId, nodeId: payload.nodeId })
  const { error } = await supabase.from('reactions').delete().eq('id', payload.id).eq('user_id', user.value!.id)
  if (!error) conv.removeReaction(payload.id, payload.nodeId)
}

// Segment-level share/unshare: flips all of the caller's OWN nodes in the
// trajectory (RLS blocks touching other authors' nodes anyway).
async function onToggleVisibility(segmentNodes: TreeNode[]) {
  if (!selectiveSharing.value) return
  const own = segmentNodes.filter((n) => n.author_id === currentUserId.value)
  if (!own.length) return
  const to = own.some((n) => n.visibility === 'private') ? 'shared' : 'private'
  const ids = own.map((n) => n.id)
  logger.log('toggle_visibility', { node_ids: ids, to, scope: 'segment' }, { conversationId, nodeId: segmentNodes[0]!.id })
  const { error } = await supabase.from('nodes').update({ visibility: to }).in('id', ids)
  if (error) return
  // Patch local state immediately — don't wait for the realtime round trip
  // (which teammates never even get for shared→private, since RLS filters it).
  for (const n of own) conv.upsert({ ...n, visibility: to })
  // Teammates don't reliably receive this UPDATE over postgres_changes either
  // way — not for shared→private (RLS filters against the new row) nor for
  // private→shared (they weren't authorized to see the old row, so Realtime
  // doesn't consistently deliver the reveal) — so broadcast it explicitly.
  if (to === 'private') rt.broadcastRetract(ids)
  else rt.broadcastReveal(ids)
}

// Own nodes on the root→selected path — what the "Share/Unshare branch"
// button in the header actually controls (teammates' own nodes are untouched).
const ownBranchNodes = computed(() => messages.value.filter((n) => n.author_id === currentUserId.value))
const branchIsShared = computed(
  () => ownBranchNodes.value.length > 0 && ownBranchNodes.value.every((n) => n.visibility === 'shared'),
)
// Whether ANY (not necessarily all) of your own turns on this branch are
// shared — without this, the button's label falls back to "Share branch" for
// a branch you've already partly shared, reading as if nothing had gone out
// yet (mirrors ChatSidebar's sharingStateOf/visBadge for the same chat).
const branchIsPartlyShared = computed(() => ownBranchNodes.value.some((n) => n.visibility === 'shared'))
// Clicking the header button either opens the share picker (nothing shared
// yet) or, if the whole branch is already shared, unshares it in one step —
// mirrors the button's own label.
const pendingShare = ref(false)
const sharePending = ref(false)
// Stopped at the button (see @click.stop in the template): opening the
// picker mounts ShareDialog and attaches its own document click-listener
// mid-bubble (Vue flushes the reactive update as a microtask *between*
// individual listener invocations, not only after the whole dispatch ends)
// — without stopping propagation here, this same click keeps bubbling to
// document right after, hits that fresh listener, and immediately closes
// the picker it just opened.
function onShareButtonClick() {
  if (!selectiveSharing.value || !selectedId.value || !ownBranchNodes.value.length) return
  if (branchIsShared.value) unshareBranch()
  else pendingShare.value = true
}
function cancelShare() {
  pendingShare.value = false
}

// "Share all" still only needs the not-yet-shared ones — already-shared own
// nodes don't need re-sharing.
const privateOwnBranchNodes = computed(() => ownBranchNodes.value.filter((n) => n.visibility === 'private'))

// The two directions a batch of own nodes can move — pure DB write + local
// state patch, no busy/dialog lifecycle of their own, so confirmShareSelected
// below can run both at once under one shared spinner/close instead of each
// toggling pendingShare/sharePending independently out from under the other.
// Returns whether the write succeeded, so a partial failure (e.g. the share
// half works but the unshare half 500s) leaves the dialog open for retry
// rather than closing over a half-applied change.
async function shareBatch(nodes: TreeNode[]): Promise<boolean> {
  const ids = nodes.map((n) => n.id)
  if (!ids.length) return true
  const { error } = await supabase.rpc('share_branch', { node_ids: ids })
  if (error) return false
  // Patch local state immediately — don't wait for the realtime round trip.
  for (const n of nodes) conv.upsert({ ...n, visibility: 'shared' })
  // Teammates weren't authorized to see these rows before this update, and
  // Realtime's postgres_changes doesn't reliably deliver an UPDATE that newly
  // reveals a row to someone who couldn't select it beforehand — broadcast it
  // explicitly instead of waiting on an event that may never arrive for them.
  rt.broadcastReveal(ids)
  return true
}
async function unshareBatch(nodes: TreeNode[]): Promise<boolean> {
  const ids = nodes.map((n) => n.id)
  if (!ids.length) return true
  const { error } = await supabase.from('nodes').update({ visibility: 'private' }).in('id', ids)
  if (error) return false
  // Patch local state immediately — don't wait for the realtime round trip
  // (teammates never receive the shared→private UPDATE at all, since RLS
  // filters it, which is why broadcastRetract exists for them below).
  for (const n of nodes) conv.upsert({ ...n, visibility: 'private' })
  rt.broadcastRetract(ids)
  return true
}

async function confirmShareAll() {
  const nodes = privateOwnBranchNodes.value
  if (!nodes.length) {
    pendingShare.value = false
    return
  }
  sharePending.value = true
  logger.log('toggle_visibility', { node_ids: nodes.map((n) => n.id), to: 'shared', scope: 'branch' }, { conversationId, nodeId: selectedId.value! })
  const ok = await shareBatch(nodes)
  sharePending.value = false
  if (ok) pendingShare.value = false
}

// The picker shows every own turn (shared + private) pre-checked to match
// its current visibility, so confirming can move turns either direction —
// newly checked ones get shared, newly unchecked ones get unshared, all in
// the one click (see ShareDialog.vue).
async function confirmShareSelected(ids: string[]) {
  const picked = new Set(ids)
  const toShare = ownBranchNodes.value.filter((n) => picked.has(n.id) && n.visibility !== 'shared')
  const toUnshare = ownBranchNodes.value.filter((n) => !picked.has(n.id) && n.visibility === 'shared')
  if (!toShare.length && !toUnshare.length) {
    pendingShare.value = false
    return
  }
  sharePending.value = true
  logger.log(
    'toggle_visibility',
    { node_ids: [...toShare, ...toUnshare].map((n) => n.id), to: 'mixed', scope: 'branch' },
    { conversationId, nodeId: selectedId.value! },
  )
  const [sharedOk, unsharedOk] = await Promise.all([shareBatch(toShare), unshareBatch(toUnshare)])
  sharePending.value = false
  if (sharedOk && unsharedOk) pendingShare.value = false
}

async function unshareBranch() {
  const own = ownBranchNodes.value.filter((n) => n.visibility === 'shared')
  if (!own.length) return
  logger.log('toggle_visibility', { node_ids: own.map((n) => n.id), to: 'private', scope: 'branch' }, { conversationId, nodeId: selectedId.value! })
  await unshareBatch(own)
}

// individual_llm only: mint a public, read-only link over the currently
// viewed thread (root through selectedId) and copy it to the clipboard —
// there's no team canvas in this condition, so this is the only way to hand
// a conversation to someone outside it. The button swaps to a checkmark
// briefly, mirroring the per-message copy-confirmation pattern in ThreadPanel.
const shareLinkPending = ref(false)
const shareLinkCopied = ref(false)
let shareLinkTimer: ReturnType<typeof setTimeout> | null = null

// Bottom-of-screen fade in/out toast (see components/ui/UiToast.vue) — the
// button's own checkmark is easy to miss if the user's eyes are elsewhere,
// so this gives a second, harder-to-miss confirmation.
const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(message: string, duration = 2200) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = null }, duration)
}

async function shareConversation() {
  if (!selectedId.value || shareLinkPending.value) return
  shareLinkPending.value = true
  let url: string
  try {
    const { id } = await $fetch('/api/share/create', {
      method: 'POST',
      body: { conversationId, nodeId: selectedId.value },
    })
    logger.log('share_conversation', { node_id: selectedId.value, share_id: id }, { conversationId, nodeId: selectedId.value })
    url = `${window.location.origin}/share/${id}`
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Could not create the share link — please retry.')
    shareLinkPending.value = false
    return
  }
  shareLinkPending.value = false

  // Split from link creation on purpose: Safari drops clipboard-write
  // permission across an intervening network await (the $fetch above), so
  // this can reject even though the share link itself was created fine — a
  // shared catch here would wrongly tell the user the share failed.
  try {
    await navigator.clipboard.writeText(url)
    shareLinkCopied.value = true
    if (shareLinkTimer) clearTimeout(shareLinkTimer)
    shareLinkTimer = setTimeout(() => { shareLinkCopied.value = false }, 2000)
    showToast('Conversation link copied to clipboard')
  } catch {
    window.prompt('Link created — copy it manually:', url)
  }
}

// Clear the whole tree — every member's branches — after an explicit confirm.
// The server route deletes nodes + reactions and detaches interaction logs;
// teammates reconcile via the 'cleared' broadcast.
async function clearTree() {
  const count = nodes.value.length
  if (!count) return
  const ok = confirm(
    `Delete all ${count} turn${count === 1 ? '' : 's'} in “${convo.value?.title || 'Untitled'}”? ` +
      'This clears the tree for the whole team and cannot be undone.',
  )
  if (!ok) return
  logger.log('clear_tree', { node_count: count }, { conversationId })
  try {
    await $fetch('/api/clear', { method: 'POST', body: { conversationId } })
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Could not clear the tree — please retry.')
    return
  }
  selectedId.value = null
  forkPointId.value = null
  drafting.value = true
  rt.broadcastCleared()
  await conv.load()
}

// ── SideNav actions ──
async function createConversation(title: string) {
  if (!user.value || !profile.value?.team_id) return
  const { data, error: e } = await supabase
    .from('conversations')
    .insert({ title: title || 'Untitled', team_id: profile.value.team_id, created_by: user.value.id })
    .select('id')
    .single()
  if (!e && data) {
    await refreshConvos()
    // Same reasoning as the fork navigation below — force a full reload
    // rather than relying on this page's own remount across two instances
    // of the same dynamic route.
    await navigateTo(`/conversation/${data.id}`, { external: true })
  }
}

async function renameConversation(id: string, title: string) {
  logger.log('rename_project', { conversation_id: id, title }, { conversationId: id })
  try {
    await $fetch('/api/rename', { method: 'POST', body: { conversationId: id, title } })
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Could not rename the project — please retry.')
    return
  }
  await refreshConvos()
}

async function deleteConversation(id: string) {
  const title = (convos.value as any[])?.find((c) => c.id === id)?.title || 'Untitled'
  const ok = confirm(
    `Delete “${title}” and its entire tree for the whole team? This cannot be undone.`,
  )
  if (!ok) return
  logger.log('delete_project', { conversation_id: id, title }, { conversationId: id })
  try {
    await $fetch('/api/delete', { method: 'POST', body: { conversationId: id } })
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Could not delete the project — please retry.')
    return
  }
  await refreshConvos()
  if (id === conversationId) await navigateTo('/')
}

async function signOut() {
  logger.log('logout', {})
  logger.flush()
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div
    class="workspace"
    :class="{ resizing }"
    :style="{
      gridTemplateColumns: individualLlm
        ? '1fr'
        : `236px minmax(0, ${1 - splitRatio}fr) minmax(0, ${splitRatio}fr)`,
    }"
  >
    <SideNav
      v-if="!individualLlm"
      :display-name="profile?.display_name ?? ''"
      :is-researcher="profile?.role === 'researcher'"
      :team-name="team?.name ?? '…'"
      :members="members ?? []"
      :conversations="convos ?? []"
      :active-id="conversationId"
      :user-id="user?.id"
      :online-ids="onlineIds"
      @create="createConversation"
      @rename="renameConversation"
      @delete="deleteConversation"
      @signout="signOut"
    />

    <!-- ── Center: chat history + selected thread ── -->
    <aside class="branchpanel">
      <ChatSidebar
        :nodes="nodes"
        :current-user-id="currentUserId"
        :selected-id="selectedId"
        :drafting="drafting"
        :draft-forks="draftForks"
        :active-draft-key="activeDraftKey"
        :show-visibility="selectiveSharing"
        @select="select"
        @select-draft="selectDraftFork"
        @delete-draft="deleteDraftFork"
        @new="startNewChat"
      />
      <div class="threadcol">
        <header class="panelhdr">
          <div class="hdrtext">
            <h2>{{ activeMergedNodeId ? 'Continue from merged context' : drafting ? 'Start a new conversation' : branchTitle }}</h2>
          </div>
          <div class="threadhdrside">
            <span v-if="forkOriginLabel" class="forkorigin">Forked from {{ forkOriginLabel }}</span>
            <UiButton
              v-if="individualLlm && selectedId && !drafting"
              variant="soft"
              class="sharebtn"
              :disabled="shareLinkPending"
              title="Copy a read-only link to this conversation"
              @click="shareConversation"
            >
              <AppIcon :name="shareLinkCopied ? 'check' : 'share'" :size="13" />
              {{ shareLinkCopied ? 'Link copied' : 'Share' }}
            </UiButton>
            <!-- SideNav (with its own sign-out) is hidden in individual_llm
                 mode (see the workspace grid below), so this is the only way
                 out of the solo chat interface. -->
            <UiButton v-if="individualLlm" variant="ghost" @click="signOut">Sign out</UiButton>
            <div class="sharewrap">
              <UiButton
                v-if="selectiveSharing && selectedId && !drafting && ownBranchNodes.length"
                variant="soft"
                class="sharebtn"
                :class="{ active: branchIsShared, partial: !branchIsShared && branchIsPartlyShared }"
                @click.stop="onShareButtonClick"
              >
                {{ branchIsShared ? 'Unshare branch' : branchIsPartlyShared ? 'Partly shared' : 'Share branch' }}
              </UiButton>
              <ShareDialog
                v-if="pendingShare"
                :nodes="ownBranchNodes"
                :member-names="memberNames"
                :busy="sharePending"
                @share-all="confirmShareAll"
                @confirm="confirmShareSelected"
                @cancel="cancelShare"
              />
            </div>
          </div>
        </header>
        <ThreadPanel
          :messages="messages"
          :fork-point-id="forkOriginNodeId"
          :member-names="memberNames"
          :current-user-id="currentUserId"
          :attachments-by-node="attachmentsByNode"
          :streaming-text="streamingText"
          :streaming-reasoning="streamingReasoning"
          :streaming-model="streamingModel"
          :is-streaming="isStreaming"
          :error="error"
          :drafting="drafting"
          :inherited-groups="inheritedGroups ?? []"
          :editable-user-node-id="editableUserNodeId"
          @edit-message="onEditMessage"
        />
        <Composer
          :conversation-id="conversationId"
          :parent-node-id="drafting ? null : selectedId"
          :forked="!!forkPointId && selectedId === forkPointId && !drafting"
          :disabled="isStreaming"
          @submit="onSubmit"
          @activity="presenceActivity.onComposerActivity"
        />
      </div>
    </aside>

    <!-- ── Right: the conversation tree (hidden for individual_llm) ── -->
    <main v-if="!individualLlm" class="treepanel">
      <div
        class="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation tree panel"
        title="Drag to resize"
        @pointerdown="onSplitterDown"
      />
      <header class="panelhdr">
        <div>
          <h1>{{ convo?.title || 'Untitled' }}</h1>
        </div>
        <div class="hdrside">
          <div class="hdrmetagroup">
            <p class="hdrmeta">Last Update at {{ lastUpdateLabel }}</p>
            <div class="facepile">
              <UiAvatar
                v-for="p in contributorAvatars"
                :key="p.id"
                class="faceitem"
                :name="p.name"
                :color-key="p.id"
                :size="26"
                :online="onlineIds.has(p.id)"
              />
            </div>
          </div>
          <UiButton
            v-if="nodes.length && profile?.role === 'researcher'"
            variant="danger"
            size="sm"
            class="clearbtn"
            :disabled="isStreaming"
            @click="clearTree"
          >
            Clear tree
          </UiButton>
        </div>
      </header>
      <CanvasFilterBar
        :authors="contributorAvatars"
        :author-id="filterAuthorId"
        :topics="availableTopics"
        :concept-id="filterConceptId"
        @update:author-id="onFilterAuthorId"
        @update:concept-id="onFilterConceptId"
      />
      <p v-if="mergeMode.state.active" class="mergehint">Select conversation nodes to organize them into a new merged node.</p>
      <div class="treewrap">
        <UiButton
          v-if="!mergeMode.state.active"
          variant="ghost"
          size="sm"
          class="mergebtn"
          :disabled="isStreaming"
          @click="mergeMode.enter()"
        >
          Merge
        </UiButton>
        <ReasoningTree
          :nodes="nodes"
          :reactions-by-node="reactionsByNode"
          :selected-id="selectedId"
          :current-user-id="currentUserId"
          :member-names="memberNames"
          :presence-by-segment="presenceBySegment"
          :show-visibility="selectiveSharing"
          :merged-nodes="mergedNodesStore.nodes.value"
          :merge-mode="mergeMode.state.active"
          :merge-selected-ids="mergeMode.state.selectedIds"
          :highlight-author-id="filterAuthorId"
          :concepts-by-segment="conceptsStore.bySegment"
          :concepts-pending="conceptsStore.pending"
          :highlight-concept-id="filterConceptId"
          @select="select"
          @fork="onFork"
          @react="onReact"
          @unreact="onUnreact"
          @toggle-visibility="onToggleVisibility"
          @toggle-merge-select="onToggleMergeSelect"
          @fork-merge="onForkMerge"
          @delete-merge="onDeleteMerge"
          @request-concepts="onRequestConcepts"
        />
      </div>

      <div v-if="mergeMode.state.active" class="mergebar">
        <span>{{ mergeMode.state.selectedIds.size }} conversation node{{ mergeMode.state.selectedIds.size === 1 ? '' : 's' }} selected</span>
        <div class="mergebaractions">
          <UiButton variant="ghost" @click="mergeMode.cancel()">Cancel</UiButton>
          <UiButton variant="primary" :disabled="!canContinueMerge" @click="openMergeModal">Continue</UiButton>
        </div>
      </div>
    </main>

    <MergeModal
      v-if="showMergeModal"
      :conversation-id="conversationId"
      :sources="modalSources"
      :member-names="memberNames"
      @created="onMergeCreated"
      @cancel="cancelMergeModal"
    />

    <UiConfirmDialog
      v-if="pendingForkId"
      title="Fork from here and start a new conversation?"
      description="You can continue chatting with AI with the prior conversation in this node as context. Your new messages will build on this context."
      @confirm="confirmFork"
      @cancel="cancelFork"
    />

    <UiToast :message="toastMessage" />
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  height: 100vh;
}
.workspace.resizing {
  cursor: col-resize;
  user-select: none;
}
.workspace.resizing * {
  cursor: col-resize !important;
}

.panelhdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  box-sizing: border-box;
  height: 72px;
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.crumb {
  margin: 0 0 2px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  line-height: 1.2;
}
.panelhdr h1, .panelhdr h2 {
  margin: 0;
  font-weight: 600;
  font-size: 18px;
  line-height: 1.25;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panelhdr h1, .panelhdr h2 { font-family: 'Geist', sans-serif; }
.hdrtext { min-width: 0; }
.hdrmeta { margin: 0; flex: none; font-size: 12.5px; color: var(--muted); }
.hdrside { display: flex; align-items: center; gap: 12px; flex: none; }
.hdrmetagroup { display: flex; align-items: center; gap: 10px; flex: none; }
.facepile { display: flex; align-items: center; }
.faceitem {
  border: 2px solid var(--paper);
  box-sizing: content-box;
}
.faceitem:not(:first-child) { margin-left: -8px; }
.clearbtn { flex: none; }

.treepanel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
  border-left: 2px solid var(--panel-edge);
}
.treewrap { position: relative; flex: 1; min-height: 0; }
.mergebtn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  background: var(--card);
  box-shadow: 0 6px 20px rgba(15, 15, 20, 0.12);
}
.mergehint {
  margin: 0;
  padding: 8px 22px;
  font-size: 12.5px;
  color: var(--muted);
  background: var(--accent-soft);
  border-bottom: 1px solid var(--line);
}
.mergebar {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 18px;
  background: var(--ink);
  color: #fff;
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(20, 20, 30, 0.3);
  font-size: 13.5px;
}
.mergebaractions { display: flex; gap: 10px; }

.branchpanel {
  display: flex;
  flex-direction: row;
  height: 100vh;
  min-width: 0;
  background: var(--card);
}
.splitter {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 6;
  cursor: col-resize;
  touch-action: none;
}
.splitter::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 3px;
  height: 36px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.15s ease;
}
.splitter:hover::after,
.workspace.resizing .splitter::after {
  background: var(--panel-edge);
}
.threadcol {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.threadhdrside { display: flex; align-items: center; gap: 10px; flex: none; }
.forkorigin {
  flex: none;
  font-size: 12px;
  color: var(--muted);
}
.sharewrap { position: relative; flex: none; }
.sharebtn { flex: none; }
.sharebtn.active { background: var(--accent); color: #fff; }
.sharebtn.active:hover { background: var(--accent-soft); color: var(--accent); }
/* Partly shared: distinct from both the untouched (private) and fully-shared
   (active) states — otherwise "Partly shared" reads in the same neutral
   styling as "Share branch", still looking like nothing has gone out yet.
   Same warning tone as UiBadge's v-warning, since there's no shared --warning
   CSS var to reference. */
.sharebtn.partial { border-color: #8a6d3b; color: #8a6d3b; }
</style>
