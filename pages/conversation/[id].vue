<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import type { AttachmentRef } from '~/composables/useFileUpload'
import { segmentize, sharedOrder, turnNumberOf } from '~/composables/useSegments'

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

function mostRecentChatTip(list: TreeNode[]): string | null {
  const chats = segmentize(list)
    .filter((s) => !s.parentId || s.head.is_fork_point)
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
  loadDraftForks()
  pruneDraftForks()
  // ChatGPT-style: open the most recent chat, or start drafting if none exist.
  const tip = mostRecentChatTip(nodes.value)
  if (tip) selectedId.value = tip
  else drafting.value = true
})
onBeforeUnmount(() => {
  rt.stop()
  logger.flush()
})

function select(id: string) {
  logger.log('select_branch', { node_id: id, from_node_id: selectedId.value }, { conversationId, nodeId: id })
  drafting.value = false
  activeDraftKey.value = null // leaving a draft fork just deselects it; it stays in the list
  if (id !== forkPointId.value) forkPointId.value = null // navigating away ends fork mode
  selectedId.value = id
}

function startNewChat() {
  logger.log('new_chat', {}, { conversationId })
  selectedId.value = null
  forkPointId.value = null
  activeDraftKey.value = null
  drafting.value = true
}

async function onSubmit(payload: { text: string; model: string; thinking?: string; attachments?: AttachmentRef[] }) {
  const parentNodeId = drafting.value ? null : selectedId.value
  // True only for the first message right after clicking Fork (selectedId is
  // still sitting on the fork point) — tells the server to start a brand new
  // branch here instead of leaving it to (unreliable) sibling-count inference.
  const isFork = !!forkPointId.value && parentNodeId === forkPointId.value
  const materializedDraft = activeDraftKey.value
  streamingModel.value = payload.model
  const r = await send({
    conversationId,
    parentNodeId,
    userText: payload.text,
    model: payload.model,
    thinking: payload.thinking,
    attachments: payload.attachments,
    isFork,
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
        created_at: new Date().toISOString(),
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
    },
  })
  // Pull the new pair immediately — selecting before the realtime INSERT
  // arrives would otherwise blank the thread panel for a beat. This also
  // overwrites the optimistic user node above with the server-confirmed one.
  await conv.fetchLineage(r.assistantNodeId)
  // The draft fork just became a real branch — drop its placeholder.
  if (materializedDraft) removeDraftFork(materializedDraft)
  drafting.value = false
  selectedId.value = r.assistantNodeId
  refreshConvos() // bump this project to the top of the activity-ordered list
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
  drafting.value = false
  activeDraftKey.value = key
  forkPointId.value = forkFromNodeId // thread shows history up to here + fork divider
  selectedId.value = forkFromNodeId // composer targets this node as parent
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
    forkPointId.value = null
    const tip = mostRecentChatTip(nodes.value)
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
  // Teammates never receive the shared→private UPDATE (RLS filters realtime
  // events against the new row), so tell them to drop the retracted nodes.
  if (to === 'private') rt.broadcastRetract(ids)
}

// Own nodes on the root→selected path — what the "Share/Unshare branch"
// button in the header actually controls (teammates' own nodes are untouched).
const ownBranchNodes = computed(() => messages.value.filter((n) => n.author_id === currentUserId.value))
const branchIsShared = computed(
  () => ownBranchNodes.value.length > 0 && ownBranchNodes.value.every((n) => n.visibility === 'shared'),
)
// Clicking the header button either asks for confirmation (nothing shared
// yet) or, if the whole branch is already shared, unshares it in one step —
// mirrors the button's own label.
const pendingShare = ref(false)
function onShareButtonClick() {
  if (!selectiveSharing.value || !selectedId.value || !ownBranchNodes.value.length) return
  if (branchIsShared.value) unshareBranch()
  else pendingShare.value = true
}
function cancelShare() {
  pendingShare.value = false
}

// Share the whole current conversation (branch) — no partial cutoff, it's
// all-or-nothing now that the turn picker is gone.
async function confirmShare() {
  pendingShare.value = false
  const own = ownBranchNodes.value.filter((n) => n.visibility === 'private')
  const ids = own.map((n) => n.id)
  if (!ids.length) return
  logger.log('toggle_visibility', { node_ids: ids, to: 'shared', scope: 'branch' }, { conversationId, nodeId: selectedId.value! })
  const { error } = await supabase.rpc('share_branch', { node_ids: ids })
  if (error) return
  // Patch local state immediately — don't wait for the realtime round trip.
  for (const n of own) conv.upsert({ ...n, visibility: 'shared' })
}

async function unshareBranch() {
  const own = ownBranchNodes.value.filter((n) => n.visibility === 'shared')
  const ids = own.map((n) => n.id)
  if (!ids.length) return
  logger.log('toggle_visibility', { node_ids: ids, to: 'private', scope: 'branch' }, { conversationId, nodeId: selectedId.value! })
  const { error } = await supabase.from('nodes').update({ visibility: 'private' }).in('id', ids)
  if (error) return
  // Patch local state immediately — don't wait for the realtime round trip
  // (teammates never receive the shared→private UPDATE at all, since RLS
  // filters it, which is why broadcastRetract exists for them below).
  for (const n of own) conv.upsert({ ...n, visibility: 'private' })
  rt.broadcastRetract(ids)
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
      @create="createConversation"
      @rename="renameConversation"
      @delete="deleteConversation"
      @signout="signOut"
    />

    <!-- ── Center: chat history + selected thread ── -->
    <aside class="branchpanel">
      <ChatSidebar
        :nodes="nodes"
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
            <p class="crumb">{{ drafting ? 'New chat' : forkPointId ? 'Forked chat' : 'Chat' }}</p>
            <h2>{{ drafting ? 'Start a new conversation' : branchTitle }}</h2>
          </div>
          <div class="threadhdrside">
            <span v-if="forkOriginLabel" class="forkorigin">Forked from {{ forkOriginLabel }}</span>
            <UiButton
              v-if="selectiveSharing && selectedId && !drafting && ownBranchNodes.length"
              variant="soft"
              class="sharebtn"
              :class="{ active: branchIsShared }"
              @click="onShareButtonClick"
            >
              {{ branchIsShared ? 'Unshare branch' : 'Share branch' }}
            </UiButton>
          </div>
        </header>
        <UiConfirmDialog
          v-if="pendingShare"
          title="Share this conversation to the team?"
          @confirm="confirmShare"
          @cancel="cancelShare"
        />
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
        />
        <Composer
          :conversation-id="conversationId"
          :parent-node-id="drafting ? null : selectedId"
          :forked="!!forkPointId && selectedId === forkPointId && !drafting"
          :disabled="isStreaming"
          @submit="onSubmit"
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
          <p class="crumb">Project</p>
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
                online
              />
            </div>
          </div>
          <UiButton v-if="nodes.length" variant="danger" size="sm" class="clearbtn" :disabled="isStreaming" @click="clearTree">
            Clear tree
          </UiButton>
        </div>
      </header>
      <div class="treewrap">
        <ReasoningTree
          :nodes="nodes"
          :reactions-by-node="reactionsByNode"
          :selected-id="selectedId"
          :current-user-id="currentUserId"
          :member-names="memberNames"
          :show-visibility="selectiveSharing"
          @select="select"
          @fork="onFork"
          @react="onReact"
          @unreact="onUnreact"
          @toggle-visibility="onToggleVisibility"
        />
      </div>
    </main>

    <UiConfirmDialog
      v-if="pendingForkId"
      title="Fork from here and start a new conversation?"
      @confirm="confirmFork"
      @cancel="cancelFork"
    />
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
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 18px;
  line-height: 1.25;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
.treewrap { flex: 1; min-height: 0; }

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
.sharebtn { flex: none; }
.sharebtn.active { background: var(--accent); color: #fff; }
.sharebtn.active:hover { background: var(--accent-soft); color: var(--accent); }
</style>
