<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import { segmentize } from '~/composables/useSegments'

const route = useRoute()
const conversationId = route.params.id as string
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const logger = useActionLogger()

const conv = useConversation(conversationId)
const rt = useRealtime(conversationId, conv)
const { streamingText, isStreaming, error, send } = useLLMStream()

const nodes = conv.nodes
const reactionsByNode = conv.reactionsByNode
const selectedId = ref<string | null>(null)
// Set when the user explicitly forks: the right panel then renders everything
// up to this node as prior history, with a divider before the new branch.
const forkPointId = ref<string | null>(null)
// True after "New chat" until the first message (or selecting an existing chat).
const drafting = ref(false)
const currentUserId = computed(() => user.value?.id ?? '')
const messages = computed(() => (drafting.value ? [] : conv.lineageOf(selectedId.value)))

// ── Resizable right (chat) panel ──
const RIGHT_W_KEY = 'convfork:rightPanelWidth'
const RIGHT_W_DEFAULT = 560
const RIGHT_W_MIN = 360
const rightWidth = ref(RIGHT_W_DEFAULT)
const resizing = ref(false)

function clampRightWidth(w: number) {
  const max = Math.max(RIGHT_W_MIN, Math.floor(window.innerWidth * 0.62))
  return Math.min(max, Math.max(RIGHT_W_MIN, Math.round(w)))
}

function onSplitterDown(e: PointerEvent) {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startW = rightWidth.value

  const onMove = (ev: PointerEvent) => {
    // Dragging the left edge of the chat panel leftward widens it.
    rightWidth.value = clampRightWidth(startW + (startX - ev.clientX))
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    try {
      localStorage.setItem(RIGHT_W_KEY, String(rightWidth.value))
    } catch { /* ignore */ }
    // Let Vue Flow / canvas remeasure the center pane.
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

const selectiveSharing = computed(() => team.value?.sharing_condition !== 'default')

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
  // sort by most recent activity, falling back to creation time.
  const { data } = await supabase
    .from('conversations')
    .select('id, title, created_at, nodes(created_at)')
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
const branchCount = computed(() => {
  const hasChild = new Set(nodes.value.map((n) => n.parent_id).filter(Boolean))
  return nodes.value.filter((n) => !hasChild.has(n.id)).length
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

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem(RIGHT_W_KEY))
    if (Number.isFinite(saved) && saved > 0) rightWidth.value = clampRightWidth(saved)
  } catch { /* ignore */ }

  await conv.load()
  rt.start()
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
  if (id !== forkPointId.value) forkPointId.value = null // navigating away ends fork mode
  selectedId.value = id
}

function startNewChat() {
  logger.log('new_chat', {}, { conversationId })
  selectedId.value = null
  forkPointId.value = null
  drafting.value = true
}

async function onSubmit(text: string) {
  const parentNodeId = drafting.value ? null : selectedId.value
  const r = await send({ conversationId, parentNodeId, userText: text })
  // Pull the new pair immediately — selecting before the realtime INSERT
  // arrives would otherwise blank the thread panel for a beat.
  await conv.fetchLineage(r.assistantNodeId)
  drafting.value = false
  selectedId.value = r.assistantNodeId
  refreshConvos() // bump this project to the top of the activity-ordered list
}

function onFork(id: string) {
  logger.log('fork', { from_node_id: id }, { conversationId, nodeId: id })
  drafting.value = false
  forkPointId.value = id // right panel shows history up to here + fork divider
  selectedId.value = id // composer now targets this node as parent
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
  await supabase.from('nodes').update({ visibility: to }).in('id', ids)
  // Teammates never receive the shared→private UPDATE (RLS filters realtime
  // events against the new row), so tell them to drop the retracted nodes.
  if (to === 'private') rt.broadcastRetract(ids)
}

// Share the whole selected branch: flip all of the caller's own private nodes on
// the root→selected path to shared, in one transaction (RPC).
async function shareBranch() {
  if (!selectiveSharing.value || !selectedId.value) return
  const ids = conv
    .lineageOf(selectedId.value)
    .filter((n) => n.author_id === currentUserId.value && n.visibility === 'private')
    .map((n) => n.id)
  if (!ids.length) return
  logger.log('toggle_visibility', { node_ids: ids, to: 'shared', scope: 'branch' }, { conversationId, nodeId: selectedId.value })
  await supabase.rpc('share_branch', { node_ids: ids })
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
    await navigateTo(`/conversation/${data.id}`)
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
    :style="{ gridTemplateColumns: `236px minmax(0, 1fr) ${rightWidth}px` }"
  >
    <SideNav
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

    <!-- ── Center: the conversation tree ── -->
    <main class="treepanel">
      <header class="panelhdr">
        <div>
          <p class="crumb">Project</p>
          <h1>{{ convo?.title || 'Untitled' }}</h1>
        </div>
        <div class="hdrside">
          <p class="hdrmeta">
            {{ branchCount }} branch{{ branchCount === 1 ? '' : 'es' }} · {{ nodes.length }} turn{{ nodes.length === 1 ? '' : 's' }}
          </p>
          <button v-if="nodes.length" class="clearbtn" :disabled="isStreaming" @click="clearTree">
            Clear tree
          </button>
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

    <!-- ── Right: chat history + selected thread ── -->
    <aside class="branchpanel">
      <div
        class="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        title="Drag to resize"
        @pointerdown="onSplitterDown"
      />
      <ChatSidebar
        :nodes="nodes"
        :selected-id="selectedId"
        :drafting="drafting"
        @select="select"
        @new="startNewChat"
      />
      <div class="threadcol">
        <header class="panelhdr">
          <div class="hdrtext">
            <p class="crumb">{{ drafting ? 'New chat' : forkPointId ? 'Forked chat' : 'Chat' }}</p>
            <h2>{{ drafting ? 'Start a new conversation' : branchTitle }}</h2>
          </div>
          <button
            v-if="selectiveSharing && selectedId && !drafting"
            class="sharebtn"
            @click="shareBranch"
          >
            Share branch
          </button>
        </header>
        <ThreadPanel
          :messages="messages"
          :fork-point-id="forkPointId"
          :member-names="memberNames"
          :current-user-id="currentUserId"
          :streaming-text="streamingText"
          :is-streaming="isStreaming"
          :error="error"
          :drafting="drafting"
          :show-visibility="selectiveSharing"
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
.clearbtn {
  flex: none;
  padding: 6px 12px;
  border: 1px solid #dbb7b1;
  border-radius: 8px;
  background: #f9edeb;
  color: #a2453c;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.clearbtn:hover:not(:disabled) { background: #a2453c; border-color: #a2453c; color: #fff; }
.clearbtn:disabled { opacity: 0.5; cursor: default; }

.treepanel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
}
.treewrap { flex: 1; min-height: 0; }

.branchpanel {
  position: relative;
  display: flex;
  flex-direction: row;
  height: 100vh;
  min-width: 0;
  background: var(--card);
  border-left: 2px solid var(--panel-edge);
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
.sharebtn {
  flex: none;
  padding: 6px 12px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sharebtn:hover { background: var(--accent); color: #fff; }
</style>
