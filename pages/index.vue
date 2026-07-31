<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const logger = useActionLogger()

const { data: profile, refresh: refreshProfile } = await useAsyncData('profile', async () => {
  if (!user.value) return null
  const { data } = await supabase
    .from('users')
    .select('display_name, team_id, role')
    .eq('id', user.value.id)
    .single()
  return data
})

const hasTeam = computed(() => !!profile.value?.team_id)

// Team name for the header (only resolvable once the user is in a team — RLS).
const { data: team, refresh: refreshTeam } = await useAsyncData('team', async () => {
  if (!profile.value?.team_id) return null
  const { data } = await supabase
    .from('teams')
    .select('name')
    .eq('id', profile.value.team_id)
    .single()
  return data
}, { watch: [() => profile.value?.team_id] })

interface Member { id: string; display_name: string; role: string | null }
const { data: members, refresh: refreshMembers } = await useAsyncData('members', async () => {
  if (!profile.value?.team_id) return [] as Member[]
  const { data } = await supabase
    .from('users')
    .select('id, display_name, role')
    .eq('team_id', profile.value.team_id)
    .order('display_name')
  return (data ?? []) as Member[]
}, { watch: [() => profile.value?.team_id] })

const { data: conversations, refresh: refreshConvos } = await useAsyncData('conversations', async () => {
  if (!profile.value?.team_id) return []
  const { data } = await supabase
    .from('conversations')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
  return data ?? []
}, { watch: [() => profile.value?.team_id] })

// All nodes visible to me (RLS scopes to my team's shared nodes + my own) —
// powers the stat cards, the mini tree per conversation, and the branch rails.
interface DashNode {
  id: string
  conversation_id: string
  parent_id: string | null
  author_id: string
  is_fork_point: boolean
  content: string
  created_at: string
}
const { data: allNodes, refresh: refreshNodes } = await useAsyncData('dashNodes', async () => {
  if (!profile.value?.team_id) return [] as DashNode[]
  // Newest first: with a row cap, ascending order would keep the OLDEST rows
  // and silently drop all new activity once a team passes the limit.
  const { data } = await supabase
    .from('nodes')
    .select('id, conversation_id, parent_id, author_id, is_fork_point, content, created_at')
    .order('created_at', { ascending: false })
    .limit(4000)
  return (data ?? []) as DashNode[]
}, { watch: [() => profile.value?.team_id] })

// Reactions are now free-form emoji; the 📌 pushpin still feeds the "Pinned
// branches" rail and the 💬 speech balloon counts as an "open direction".
const PIN_EMOJI = '📌'
const DISCUSS_EMOJI = '💬'
interface DashReaction { node_id: string; type: string; created_at: string }
const { data: marks, refresh: refreshMarks } = await useAsyncData('dashMarks', async () => {
  if (!profile.value?.team_id) return [] as DashReaction[]
  const { data } = await supabase
    .from('reactions')
    .select('node_id, type, created_at')
    .in('type', [PIN_EMOJI, DISCUSS_EMOJI])
    .order('created_at', { ascending: false })
  return (data ?? []) as DashReaction[]
}, { watch: [() => profile.value?.team_id] })

// ── Derived dashboard data ──
const nodesByConv = computed(() => {
  const map = new Map<string, DashNode[]>()
  for (const n of allNodes.value ?? []) {
    const list = map.get(n.conversation_id)
    if (list) list.push(n)
    else map.set(n.conversation_id, [n])
  }
  return map
})

const nodeById = computed(() => new Map((allNodes.value ?? []).map((n) => [n.id, n])))
const memberById = computed(() => new Map((members.value ?? []).map((m) => [m.id, m])))
const convTitleById = computed(
  () => new Map((conversations.value ?? []).map((c: any) => [c.id, c.title || 'Untitled'])),
)

// A "branch" is a path tip: any node no one has replied to yet.
const branchTips = computed(() => {
  const nodes = allNodes.value ?? []
  const hasChild = new Set(nodes.map((n) => n.parent_id).filter(Boolean) as string[])
  return nodes.filter((n) => !hasChild.has(n.id))
})

const stats = computed(() => ({
  branches: branchTips.value.length,
  contributors: new Set((allNodes.value ?? []).map((n) => n.author_id)).size,
  openDirections: new Set(
    (marks.value ?? []).filter((m) => m.type === DISCUSS_EMOJI).map((m) => m.node_id),
  ).size,
}))

const recentBranches = computed(() =>
  [...branchTips.value]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5),
)

const pinnedBranches = computed(() => {
  const seen = new Set<string>()
  const out: DashNode[] = []
  for (const m of marks.value ?? []) {
    if (m.type !== PIN_EMOJI || seen.has(m.node_id)) continue
    seen.add(m.node_id)
    const node = nodeById.value.get(m.node_id)
    if (node) out.push(node)
    if (out.length >= 5) break
  }
  return out
})

interface ConvCard {
  id: string
  title: string
  updatedAt: string
  nodeCount: number
  branchCount: number
  nodes: DashNode[]
}
const convCards = computed<ConvCard[]>(() => {
  const tipsByConv = new Map<string, number>()
  for (const t of branchTips.value) {
    tipsByConv.set(t.conversation_id, (tipsByConv.get(t.conversation_id) ?? 0) + 1)
  }
  return (conversations.value ?? []).map((c: any) => {
    const nodes = nodesByConv.value.get(c.id) ?? []
    return {
      id: c.id,
      title: c.title || 'Untitled',
      // nodes arrive newest-first, so the group's first entry is the latest
      updatedAt: nodes.length ? nodes[0]!.created_at : c.created_at,
      nodeCount: nodes.length,
      branchCount: tipsByConv.get(c.id) ?? 0,
      nodes,
    }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

// ── Presentation helpers ──
function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

function snippet(text: string, len = 64) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean || '(empty)'
}

const authorName = (id: string) => memberById.value.get(id)?.display_name ?? 'Unknown'

const today = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

// ── Create conversation (the "+" next to Projects in SideNav) ──
const sideNav = ref<{ openCreate: () => void } | null>(null)

async function createConversation(title: string) {
  if (!user.value || !profile.value?.team_id) return
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      title: title || 'Untitled',
      team_id: profile.value.team_id,
      created_by: user.value.id,
    })
    .select('id')
    .single()
  if (!error && data) {
    await refreshConvos()
    await navigateTo(`/conversation/${data.id}`)
  }
}

// ── Realtime: re-resolve when my profile (e.g. team assignment) changes ──
let channel: RealtimeChannel | null = null

function setupRealtime() {
  if (!user.value) return
  teardownRealtime()
  const ch = supabase.channel(`home:${user.value.id}`)

  ch.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.value.id}` },
    async () => {
      await refreshProfile()
      await Promise.all([
        refreshTeam(), refreshConvos(),
        refreshMembers(), refreshNodes(), refreshMarks(),
      ])
    },
  )

  ch.subscribe()
  channel = ch
}

function teardownRealtime() {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
}

onMounted(() => {
  logger.log('login', {})
  setupRealtime()
})
watch(() => profile.value?.team_id, setupRealtime)
onUnmounted(teardownRealtime)

async function signOut() {
  logger.log('logout', {})
  logger.flush()
  teardownRealtime()
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <!-- Team-less: should not happen for admin-provisioned accounts -->
  <div v-if="!hasTeam" class="joinpage">
    <section class="join">
      <p class="brand">Conv<em>Fork</em></p>
      <h2>No session assigned</h2>
      <p class="hint">
        Your account is not linked to a study session yet. Ask the study admin to create
        your User ID and Session ID, then sign in again.
      </p>
      <button class="signout-link" @click="signOut">Sign out</button>
    </section>
  </div>

  <!-- Member dashboard -->
  <div v-else class="dash">
    <!-- ── Left rail: identity, team, projects, settings ── -->
    <SideNav
      ref="sideNav"
      :display-name="profile?.display_name ?? ''"
      :is-researcher="profile?.role === 'researcher'"
      :team-name="team?.name ?? '…'"
      :members="members ?? []"
      :conversations="convCards"
      :user-id="user?.id"
      @create="createConversation"
      @signout="signOut"
    />

    <!-- ── Center: welcome, stats, conversation trees ── -->
    <main class="center">
      <header class="welcome">
        <h1>Welcome back, {{ profile?.display_name }}</h1>
        <p class="date">{{ today }}</p>
      </header>

      <section class="statrow">
        <div class="stat">
          <p class="statlabel">Active branches</p>
          <p class="statnum">{{ stats.branches }}</p>
          <p class="statsub">paths being explored</p>
        </div>
        <div class="stat">
          <p class="statlabel">Contributors</p>
          <p class="statnum">{{ stats.contributors }}</p>
          <p class="statsub">people writing nodes</p>
        </div>
        <div class="stat">
          <p class="statlabel">Open directions</p>
          <p class="statnum">{{ stats.openDirections }}</p>
          <p class="statsub">marked to discuss</p>
        </div>
      </section>

      <section class="trees">
        <p class="navlabel">All conversation trees</p>
        <NuxtLink
          v-for="c in convCards"
          :key="c.id"
          :to="`/conversation/${c.id}`"
          class="treecard"
        >
          <div class="viz"><MiniTree :nodes="c.nodes" /></div>
          <div class="treemeta">
            <h3>{{ c.title }}</h3>
            <p class="meta">
              {{ c.branchCount }} branch{{ c.branchCount === 1 ? '' : 'es' }}
              · {{ c.nodeCount }} turn{{ c.nodeCount === 1 ? '' : 's' }}
              · updated {{ timeAgo(c.updatedAt) }}
            </p>
          </div>
          <span class="go">→</span>
        </NuxtLink>
        <div v-if="!convCards.length" class="treesempty">
          <p>No conversation trees yet.</p>
          <UiButton @click="sideNav?.openCreate()">Start the first one</UiButton>
        </div>
      </section>
    </main>

    <!-- ── Right rail: recent + pinned branches ── -->
    <aside class="rail">
      <div class="railsection">
        <p class="navlabel">Recent branches</p>
        <ul class="branchlist">
          <li v-for="n in recentBranches" :key="n.id">
            <NuxtLink :to="`/conversation/${n.conversation_id}`">
              <p class="btext">{{ snippet(n.content) }}</p>
              <p class="bmeta">
                {{ convTitleById.get(n.conversation_id) }} · {{ authorName(n.author_id) }} · {{ timeAgo(n.created_at) }}
              </p>
            </NuxtLink>
          </li>
          <li v-if="!recentBranches.length" class="navempty">Nothing yet.</li>
        </ul>
      </div>

      <div class="railsection">
        <p class="navlabel">Pinned branches</p>
        <ul class="branchlist">
          <li v-for="n in pinnedBranches" :key="n.id" class="pinned">
            <NuxtLink :to="`/conversation/${n.conversation_id}`">
              <p class="btext">📌 {{ snippet(n.content) }}</p>
              <p class="bmeta">
                {{ convTitleById.get(n.conversation_id) }} · {{ authorName(n.author_id) }}
              </p>
            </NuxtLink>
          </li>
          <li v-if="!pinnedBranches.length" class="navempty">Pin a node in any tree to keep it here.</li>
        </ul>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* ── Theme (tokens come from :root in app.vue) ── */
.dash, .joinpage { background: var(--paper); }

.brand {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 21px;
  letter-spacing: -0.01em;
}
.brand em { font-style: italic; color: var(--accent); }

.navlabel {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ── Layout ── */
.dash {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 264px;
  min-height: 100vh;
}
@media (max-width: 1080px) {
  .dash { grid-template-columns: 236px minmax(0, 1fr); }
  .rail { grid-column: 2; border-left: 0; border-top: 1px solid var(--line); }
}

.navempty { padding: 6px 4px; font-size: 12.5px; color: var(--muted); }

/* ── Center ── */
.center { padding: 30px 34px 48px; min-width: 0; }
.welcome h1 {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 30px;
  letter-spacing: -0.02em;
}
.date { margin: 4px 0 0; color: var(--muted); font-size: 13.5px; }

.statrow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 26px;
}
.stat {
  padding: 18px 20px 16px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.statlabel {
  margin: 0;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--muted);
}
.statnum {
  margin: 6px 0 0;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 40px;
  line-height: 1;
  letter-spacing: -0.02em;
}
.statsub { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }

.trees { margin-top: 30px; }
.treecard {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 12px;
  padding: 16px 20px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--ink);
  text-decoration: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.treecard:hover {
  border-color: #d3cdf7;
  box-shadow: 0 10px 26px rgba(20, 20, 30, 0.07);
  transform: translateY(-1px);
}
.viz {
  flex: none;
  width: 168px; height: 84px;
  padding: 4px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.treemeta { min-width: 0; }
.treemeta h3 {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 19px;
  letter-spacing: -0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.meta { margin: 5px 0 0; font-size: 13px; color: var(--muted); }
.go {
  margin-left: auto;
  color: var(--accent);
  font-size: 18px;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.treecard:hover .go { opacity: 1; transform: translateX(0); }

.treesempty {
  margin-top: 12px;
  padding: 40px;
  text-align: center;
  color: var(--muted);
  background: var(--card);
  border: 1px dashed var(--line);
  border-radius: 14px;
}
.treesempty p { margin: 0 0 14px; }

/* ── Right rail ── */
.rail {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 30px 22px;
  border-left: 2px solid var(--panel-edge);
}
.branchlist { list-style: none; margin: 0; padding: 0; }
.branchlist li a {
  display: block;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 11px;
  text-decoration: none;
  color: var(--ink);
  transition: border-color 0.15s ease;
}
.branchlist li a:hover { border-color: var(--accent); }
.branchlist li.pinned a { border-left: 3px solid var(--accent); }
.btext { margin: 0; font-size: 13px; line-height: 1.4; }
.bmeta {
  margin: 5px 0 0;
  font-size: 11.5px;
  color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Join-team page (team-less users) ── */
.joinpage { display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
.join {
  width: 420px;
  padding: 32px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.join .brand { margin-bottom: 18px; }
.join h2 { margin: 0; font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; }
.join .hint { color: var(--muted); font-size: 13.5px; margin: 6px 0 16px; }
.join .teams { list-style: none; padding: 0; margin: 0; }
.join .teams li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.join .count { color: var(--muted); font-size: 12px; margin-left: 8px; }
.join button {
  padding: 7px 14px; border: 0; border-radius: 8px;
  background: var(--accent); color: #fff;
  font: inherit; font-size: 13px; cursor: pointer;
}
.join button.requested { background: var(--line); color: var(--muted); cursor: default; }
.join .empty { color: var(--muted); justify-content: center; font-size: 13.5px; }
.signout-link {
  margin-top: 18px;
  background: none !important;
  color: var(--accent) !important;
  padding: 0 !important;
}
</style>
