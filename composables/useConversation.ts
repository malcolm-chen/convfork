// Loads a conversation's visible nodes + reactions into reactive maps and
// derives the tree (adjacency) and linear lineage. Reconstruction is from
// parent_id, never event order (design doc §8), so missed/out-of-order events
// self-heal on the next fetch.

export interface TreeNode {
  id: string
  conversation_id: string
  parent_id: string | null
  author_id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string | null
  visibility: 'private' | 'shared'
  is_fork_point: boolean
  model: string | null
  // Set only on a fresh root node (parent_id null) created by forking a
  // merged context node — see server/api/chat.post.ts / MergedNodeCard.vue.
  parent_merged_node_id: string | null
  created_at: string
}

export interface Reaction {
  id: string
  node_id: string
  user_id: string
  type: string // free-form emoji (Slack-style); historically pin/discuss/built_on
  created_at: string
}

export interface Attachment {
  id: string
  node_id: string
  filename: string
  content_type: string
  size_bytes: number
  kind: 'image' | 'pdf'
  created_at: string
}

export function useConversation(conversationId: string) {
  const supabase = useSupabaseClient()
  const nodesById = reactive(new Map<string, TreeNode>())
  const reactionsByNode = reactive(new Map<string, Reaction[]>())
  const attachmentsByNode = reactive(new Map<string, Attachment[]>())
  const lastSeen = ref('1970-01-01T00:00:00Z')

  const nodes = computed(() => Array.from(nodesById.values()))

  function upsert(n: TreeNode) {
    nodesById.set(n.id, n)
    if (n.created_at > lastSeen.value) lastSeen.value = n.created_at
  }

  function addReaction(r: Reaction) {
    const arr = reactionsByNode.get(r.node_id) ?? []
    if (!arr.some((x) => x.id === r.id)) {
      arr.push(r)
      reactionsByNode.set(r.node_id, arr)
    }
  }

  // Drop a reaction by id. `nodeId` is optional — realtime DELETE events may
  // only carry the primary key under default replica identity.
  function removeReaction(id: string, nodeId?: string) {
    const dropFrom = (nid: string) => {
      const arr = reactionsByNode.get(nid)
      if (!arr) return false
      const next = arr.filter((x) => x.id !== id)
      if (next.length === arr.length) return false
      if (next.length) reactionsByNode.set(nid, next)
      else reactionsByNode.delete(nid)
      return true
    }
    if (nodeId && dropFrom(nodeId)) return
    for (const nid of [...reactionsByNode.keys()]) {
      if (dropFrom(nid)) return
    }
  }

  function addAttachment(a: Attachment) {
    const arr = attachmentsByNode.get(a.node_id) ?? []
    if (!arr.some((x) => x.id === a.id)) {
      arr.push(a)
      attachmentsByNode.set(a.node_id, arr)
    }
  }

  async function load() {
    const { data, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at')
    if (error) return
    const fetched = (data ?? []) as TreeNode[]
    for (const n of fetched) upsert(n)
    // Reconcile removals: anything we hold that the server no longer shows us
    // was retracted (shared→private) while we weren't looking. Realtime never
    // delivers that UPDATE (RLS filters it), so load() is the cleanup point.
    const visible = new Set(fetched.map((n) => n.id))
    for (const id of [...nodesById.keys()]) {
      if (!visible.has(id)) nodesById.delete(id)
    }
    await loadReactions()
    await loadAttachments()
  }

  // Drop nodes we can no longer see (author retracted them mid-session).
  function removeNodes(ids: string[]) {
    for (const id of ids) {
      nodesById.delete(id)
      reactionsByNode.delete(id)
      attachmentsByNode.delete(id)
    }
  }

  async function loadReactions() {
    const ids = nodes.value.map((n) => n.id)
    if (!ids.length) return
    const { data } = await supabase.from('reactions').select('*').in('node_id', ids)
    reactionsByNode.clear()
    for (const r of (data ?? []) as Reaction[]) addReaction(r)
  }

  async function loadAttachments() {
    const ids = nodes.value.map((n) => n.id)
    if (!ids.length) return
    const { data } = await supabase.from('attachments').select('*').in('node_id', ids)
    attachmentsByNode.clear()
    for (const a of (data ?? []) as Attachment[]) addAttachment(a)
  }

  // Fetch only nodes created since lastSeen — used on realtime reconnect (§6.5 egress).
  async function deltaFetch() {
    const { data } = await supabase
      .from('nodes')
      .select('*')
      .eq('conversation_id', conversationId)
      .gt('created_at', lastSeen.value)
      .order('created_at')
    for (const n of (data ?? []) as TreeNode[]) upsert(n)
  }

  // Pull a node's full lineage (root→node) — used when a visibility flip reveals
  // a branch we never received INSERTs for (RLS-over-realtime reconciliation).
  async function fetchLineage(id: string) {
    const { data } = await supabase.rpc('get_lineage', { target: id })
    for (const n of (data ?? []) as TreeNode[]) upsert(n)
    await loadAttachments()
  }

  function childrenOf(id: string) {
    return nodes.value.filter((n) => n.parent_id === id)
  }

  function lineageOf(id: string | null): TreeNode[] {
    const path: TreeNode[] = []
    let cur = id ? nodesById.get(id) : undefined
    const guard = new Set<string>()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      path.unshift(cur)
      cur = cur.parent_id ? nodesById.get(cur.parent_id) : undefined
    }
    return path
  }

  return {
    nodesById,
    reactionsByNode,
    attachmentsByNode,
    nodes,
    lastSeen,
    load,
    loadReactions,
    loadAttachments,
    deltaFetch,
    fetchLineage,
    upsert,
    addReaction,
    removeReaction,
    addAttachment,
    removeNodes,
    childrenOf,
    lineageOf,
  }
}
