# Collaborative LLM Environment — System Architecture & Data Design

> A collaboration system for a 3-week field study: ~10 people online at once, each chatting with the agent in their own thread.
> Core abstraction: a conversation is a **tree of message nodes**; a fork = adding a child node under any existing node.
> Stack: Nuxt (Vue 3) + Supabase (Postgres + realtime + auth) + a server-side LLM proxy (SSE streaming).

---

## 1. System Overview

| Layer | Choice | Responsibility |
|---|---|---|
| Frontend | Nuxt 3 (Vue 3) + Vue Flow | Reasoning-tree visualization, thread panel, composer, reaction controls, **action-log capture** |
| Server routes | Nuxt Nitro server route | LLM proxy: hold the API key, rebuild lineage context, stream via SSE, write nodes back |
| DB / realtime / auth | Supabase (managed Postgres) | Persistence, RLS row-level security, realtime subscriptions (team awareness), login |
| LLM | Claude / GPT API | Called only via the server proxy; the client never holds the key |
| Deployment | Vercel (frontend + Nitro) + Supabase cloud | Stateless frontend + managed DB; safe to hot-fix and redeploy anytime |

**Key design principles**

- **Nodes are append-only and immutable.** A message is never edited once written, so no CRDT is needed; and because nodes are immutable, the tree state at any moment `t` can be reconstructed by filtering `created_at <= t` — which is essential for log reconstruction (see §6).
- **Stream to the initiator, persist-then-broadcast.** LLM tokens are streamed via SSE only to the browser that made the request; once the response completes it is written to Postgres, and Supabase realtime fans it out to the whole team. Team awareness comes from the database round-trip, not the streaming channel.
- **Private by default, selective sharing.** You can only fork from an already-shared node; sharing a branch = flipping your own nodes from `private` to `shared`.

---

## 2. Architecture

### 2.1 Frontend (Nuxt + Vue 3)

```
/
├── nuxt.config.ts                # runtimeConfig injects Supabase / LLM keys
├── app.vue
├── pages/
│   ├── index.vue                 # team / conversation list
│   └── conversation/[id].vue     # single shared-tree workspace
├── components/
│   ├── tree/
│   │   ├── ReasoningTree.vue      # Vue Flow renders the tree (subscribes to realtime)
│   │   ├── TreeNode.vue           # one node: author, visibility, reaction buttons
│   │   └── ForkButton.vue         # fork from a given node
│   ├── thread/
│   │   ├── ThreadPanel.vue        # linear path of the currently selected branch
│   │   └── Composer.vue           # input box: add a turn or start a new fork
│   └── reactions/ReactionBar.vue  # 📌pin / 💬discuss / 🔗built-on
├── composables/
│   ├── useSupabase.ts             # singleton supabase-js client
│   ├── useRealtime.ts             # subscribe to inserts on nodes / reactions
│   ├── useConversation.ts         # rebuild tree / lineage from nodes
│   ├── useLLMStream.ts            # call /api/chat, consume the SSE token stream
│   └── useActionLogger.ts        # ★ action-log capture (batched + debounced)
├── server/
│   └── api/
│       ├── chat.post.ts           # ★ LLM proxy + SSE (see 2.2)
│       └── logs.post.ts           # ★ batch ingest of action logs (optional, see 6.3)
└── server/utils/
    ├── supabaseAdmin.ts           # service_role client (server-only)
    └── lineage.ts                 # walk node_id up parent_id to the root
```

Key modules:

- `ReasoningTree.vue`: renders a node-link tree with `@vue-flow/core`; on mount it uses `useRealtime` to subscribe to inserts on `nodes`/`reactions` for the current `conversation_id`, so new branches and reactions update **in place** — this is the team-awareness mechanism.
- `useLLMStream.ts`: `fetch('/api/chat')` reads a `ReadableStream` and updates the composer token by token; it does not write to the DB — persistence is done server-side.
- `useActionLogger.ts`: a global action collector that buffers events in memory and writes them **debounced / batched** (see §6.3), so not every click/keystroke triggers a network call.

### 2.2 Backend (Supabase + Nitro proxy)

Supabase carries most of the backend: tables, RLS, realtime, login — almost no backend code to write.

The only self-written server piece is the LLM proxy `server/api/chat.post.ts`:

1. Authenticate the logged-in user (from the Supabase JWT).
2. Receive `{ conversationId, parentNodeId, userText }`.
3. Use `lineage(parentNodeId)` to walk `parent_id` to the root and assemble the context message sequence.
4. First insert a `role='user'` node (immediate persist → realtime broadcast).
5. Call the LLM API and **stream tokens to the initiator via SSE**.
6. After the stream ends, insert the `role='assistant'` node (persist → broadcast to the whole team).
7. Wrap everything in try/catch; retry once on failure and return a clear error state.

```ts
// server/api/chat.post.ts (skeleton)
export default defineEventHandler(async (event) => {
  const { conversationId, parentNodeId, userText } = await readBody(event)
  const user = await requireUser(event)                 // verify JWT
  const admin = useSupabaseAdmin()                       // service_role

  // 4. write the user node (broadcast immediately)
  const userNode = await admin.from('nodes').insert({
    conversation_id: conversationId, parent_id: parentNodeId,
    author_id: user.id, role: 'user', content: userText,
    visibility: 'private',
  }).select().single()

  // 3. rebuild context
  const messages = await buildLineageMessages(admin, userNode.data.id)

  // 5. SSE streaming
  setHeader(event, 'content-type', 'text/event-stream')
  const stream = await callLLM(messages)                 // returns a token async iterator
  let full = ''
  const res = new ReadableStream({
    async start(c) {
      for await (const t of stream) { full += t; c.enqueue(`data: ${t}\n\n`) }
      // 6. stream ends → write the assistant node (broadcast to team)
      await admin.from('nodes').insert({
        conversation_id: conversationId, parent_id: userNode.data.id,
        author_id: user.id, role: 'assistant', content: full,
        visibility: 'private',
      })
      c.close()
    }
  })
  return sendStream(event, res)
})
```

---

## 3. Data Flow (full path of one "send / fork")

```
User types and sends at some node
   │ (frontend useActionLogger records an action: type → send_message)
   ▼
POST /api/chat { conversationId, parentNodeId, userText }
   │
   ├─ write user node ──► Supabase realtime ──► push to whole team (new node appears on the tree)
   ├─ rebuild lineage context ──► call LLM API
   ├─ SSE token stream ──► only back to the initiator's browser (token-by-token)
   └─ stream ends → write assistant node ──► Supabase realtime ──► push to whole team
```

The only difference between forking and a normal send: `parentNodeId` points at a **non-leaf** node (and it must be `shared`). The rest of the path is identical.

---

## 4. Database Connections

| Scenario | What connects | Key | Permission boundary |
|---|---|---|---|
| Browser reads/writes data | `supabase-js` (`useSupabase` singleton) | **anon key** | Bound by **RLS** — can only touch rows visible to the user/team |
| Realtime subscriptions | `supabase-js` realtime channel | anon key | Same — RLS filters what gets pushed |
| Server LLM proxy / log writes | `supabase-js` (`supabaseAdmin`) | **service_role key** (in `server/` only, never exposed to the client) | Bypasses RLS; handles system-level writes |
| Research analysis / export | Direct Postgres connection string (read-only account) | DB password | Connected manually during analysis to run SQL / export CSV |

Connection notes:

- Keys are injected via Nuxt `runtimeConfig`: `public.supabaseAnonKey` for the client; `supabaseServiceKey` / `dbUrl` are server-only.
- **Serverless connection pooling**: Nitro on Vercel runs as serverless functions; connecting directly to Postgres can exhaust connections, so use Supabase's pooler endpoint (pooler / pgbouncer, transaction mode) rather than direct port 5432. But if you only use `supabase-js` (which goes over PostREST/HTTP), you don't need to worry about connection counts at all — 10 users is no pressure.
- The client never holds the service_role key or the LLM API key.

---

## 5. Data Schema to Maintain

### 5.1 Core domain tables

```sql
-- teams
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- users (linked to Supabase auth.users)
create table users (
  id          uuid primary key references auth.users(id),
  team_id     uuid references teams(id),
  display_name text not null,
  role        text,                       -- study role, e.g. researcher/designer
  created_at  timestamptz not null default now()
);

-- one shared conversation = one reasoning tree
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  title       text,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

-- message nodes (core of the tree; append-only, immutable)
create table nodes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  parent_id       uuid references nodes(id),          -- null = root node
  author_id       uuid not null references users(id),
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  visibility      text not null default 'private'
                    check (visibility in ('private','shared')),
  is_fork_point   boolean not null default false,     -- marks this node as the start of a fork
  created_at      timestamptz not null default now()
);
create index idx_nodes_conv    on nodes(conversation_id);
create index idx_nodes_parent  on nodes(parent_id);
create index idx_nodes_created on nodes(conversation_id, created_at);

-- reaction buttons
create table reactions (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id),
  user_id     uuid not null references users(id),
  type        text not null check (type in ('pin','discuss','built_on')),
  created_at  timestamptz not null default now(),
  unique (node_id, user_id, type)
);
```

**Lineage query** (rebuild a node's context / compute lineage depth):

```sql
with recursive lineage as (
  select * from nodes where id = $1
  union all
  select n.* from nodes n join lineage l on n.id = l.parent_id
)
select * from lineage order by created_at;   -- full chain from root to target
```

### 5.2 ★ User action log table (user_action_logs)

Records each user's fine-grained operations. Fields map to the requirement: **timestamp / action_type / action_content / conversation history**.

```sql
create table user_action_logs (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),   -- ① timestamp
  user_id         uuid not null references users(id),
  session_id      uuid,                                 -- one login session, for segmentation
  team_id         uuid references teams(id),

  action_type     text not null,                        -- ② action type (see enum)
  action_content  jsonb not null default '{}',          -- ③ action content (flexible payload)

  -- ④ conversation history: reference, not snapshot (see §6.2)
  conversation_id uuid references conversations(id),
  node_id         uuid references nodes(id),            -- the node this action relates to
  context_snapshot jsonb                                -- optional: message snapshot on send/receive
);
create index idx_ual_user  on user_action_logs(user_id, ts);
create index idx_ual_team  on user_action_logs(team_id, ts);
create index idx_ual_type  on user_action_logs(action_type, ts);
create index idx_ual_conv  on user_action_logs(conversation_id, ts);
```

Suggested `action_type` enum (extend as needed):

| Category | action_type | action_content example |
|---|---|---|
| Input | `type` / `input_change` | `{ "len": 42 }` (debounced length, not every keystroke) |
| Send | `send_message` | `{ "text": "...", "parent_node_id": "..." }` |
| Receive | `receive_response` | `{ "node_id": "...", "tokens": 180, "latency_ms": 2400 }` |
| Fork | `fork` | `{ "from_node_id": "...", "from_author": "..." }` |
| Visibility | `toggle_visibility` | `{ "node_id": "...", "from": "private", "to": "shared" }` |
| Reaction | `react` | `{ "node_id": "...", "type": "pin" }` |
| Navigation | `navigate` / `select_branch` | `{ "node_id": "...", "from_node_id": "..." }` |
| View | `expand` / `collapse` / `zoom` / `pan` | `{ "node_id": "..." }` |
| Click | `click` | `{ "target": "fork_button", "node_id": "..." }` |
| Session | `login` / `logout` | `{ }` |

### 5.3 ★ Team interaction log table (team_interaction_logs)

Records **cross-member** interactions specifically — the direct data source for your RQ2 / Study 2 metrics.

```sql
create table team_interaction_logs (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  team_id           uuid not null references teams(id),
  conversation_id   uuid references conversations(id),

  actor_user_id     uuid not null references users(id),   -- who initiated the interaction
  target_user_id    uuid references users(id),            -- whose artifact was acted on (nullable)

  interaction_type  text not null,                        -- see enum
  source_node_id    uuid references nodes(id),            -- node forked / reacted to
  result_node_id    uuid references nodes(id),            -- new node produced by the fork (if any)
  metadata          jsonb not null default '{}'
);
create index idx_til_team   on team_interaction_logs(team_id, ts);
create index idx_til_actor  on team_interaction_logs(actor_user_id, ts);
create index idx_til_target on team_interaction_logs(target_user_id, ts);
create index idx_til_type   on team_interaction_logs(interaction_type, ts);
```

`interaction_type` enum and the corresponding research metrics:

| interaction_type | Meaning | Maps to Study 2 metric |
|---|---|---|
| `fork_from_other` | Fork from someone else's branch | fork timing, fork points, who builds on whom |
| `share_to_team` | Share a private branch to the team | boundary-crossing timing |
| `view_other_branch` | Enter and view another's branch | awareness |
| `react_to_other` | pin/discuss/built-on on another's node | collaborative alignment signals |
| `built_on` | Explicitly mark "built on X's branch" | lineage attribution |
| `discuss_request` | Mark "💬let's discuss" | team negotiation trigger |

> Note: events like `fork_from_other` and `react_to_other` also leave a trace in `user_action_logs`; `team_interaction_logs` is a **de-noised, aggregated view of cross-member events** — query it directly during analysis rather than digging through the raw action stream. Write both tables.

### 5.4 RLS row-level security (example)

```sql
alter table nodes enable row level security;

-- read: team members see "shared" nodes + their own "private" nodes
create policy nodes_select on nodes for select using (
  (visibility = 'shared'
     and conversation_id in (
       select c.id from conversations c
       join users u on u.team_id = c.team_id
       where u.id = auth.uid()))
  or author_id = auth.uid()
);

-- write: can only write as yourself
create policy nodes_insert on nodes for insert
  with check (author_id = auth.uid());
```

> The log tables (`user_action_logs` / `team_interaction_logs`) are written server-side with the service_role key and bypass RLS. If you switch to client-side direct writes, add an insert policy of "can only write your own user_id", and **do not expose select to ordinary users** (this is research data).

---

## 6. Logging System Design (key section)

### 6.1 How the three data types relate

- **`nodes` / `reactions`**: domain data that is already a complete, timestamped record — the "factual base" the logs sit on.
- **`user_action_logs`**: the actions that **don't land on a node** (clicks, typing, navigation, zoom, visibility toggles) — if not recorded at the moment they happen, they're gone forever.
- **`team_interaction_logs`**: an aggregation of cross-member events that maps directly to the research metrics.

### 6.2 How to store conversation history (an important tradeoff)

The requirement lists "conversation history" as a field on the action log, but **do not copy the whole history into every log row** (it explodes in size and is redundant). Recommended:

1. Store `conversation_id` + `node_id` (pointers) on each action log.
2. Because `nodes` are **append-only and immutable**, the tree state at any moment `t` = filter nodes with `created_at <= t`; then run the §5.1 recursive lineage query on `node_id` to **exactly reconstruct the conversation history the user was facing when the action happened** — no snapshot needed.
3. Only for key actions like `send_message` / `receive_response`, additionally store a `context_snapshot` (the sent text, the lineage `node_id` path at that moment) so analysis doesn't even need a join.

This satisfies "the log contains conversation history" without generating massive duplicate data.

### 6.3 Frontend capture strategy (useActionLogger)

- **Batch + debounce**: buffer events in memory and flush every ~2s or when 20 accumulate; debounce `type` actions (record a length once after a pause, not every keystroke).
- **Flush channel**: batch `POST /server/api/logs`, and have the server batch-insert with the service_role key (or write directly to the table client-side with a "write own rows only" RLS policy).
- **Exit fallback**: on `beforeunload` / `visibilitychange`, flush the remaining buffer with `navigator.sendBeacon` so closing the tab doesn't drop logs.
- **session_id**: generate a uuid at login that runs through all logs for the session, making it easy to segment behavior sequences per session.

```ts
// composables/useActionLogger.ts (skeleton)
const buf: ActionLog[] = []
function log(type: string, content: object, ref?: { conversationId?: string; nodeId?: string }) {
  buf.push({ ts: new Date().toISOString(), action_type: type, action_content: content,
             session_id: sid, ...ref })
  if (buf.length >= 20) flush()
}
function flush() {
  if (!buf.length) return
  const batch = buf.splice(0)
  navigator.sendBeacon('/api/logs', JSON.stringify(batch))  // or fetch keepalive
}
setInterval(flush, 2000)
window.addEventListener('visibilitychange', () => document.hidden && flush())
```

### 6.4 Derived metrics (query directly during analysis)

| Metric | Data source |
|---|---|
| fork timing | `team_interaction_logs.ts where type='fork_from_other'` |
| fork points | `nodes.parent_id` + `is_fork_point` |
| lineage depth / topology | recursive traversal of `nodes` |
| visibility toggles | `user_action_logs where action_type='toggle_visibility'` |
| who builds on whose branch | `team_interaction_logs(actor_user_id, target_user_id)` |
| whether forks truly diverged | join `nodes` content for thematic analysis (fork-children vs parent) |
| behavior sequence / duration | `user_action_logs` ordered by `session_id, ts` |

### 6.5 Data budget under the free tier (Supabase Free / 500 MB)

The only hard limit that binds this system is the **500 MB database**, and what fills it is **logging, not conversation**. Conclusion: this study (10 people / 3 weeks) fits within the free tier, provided logging is disciplined.

- **Conversation data is small**: a few thousand nodes, assistant responses averaging a few KB → tens of MB. Not an issue.
- **Action logs are the variable**: with disciplined logging, 150–200k rows ≈ 60–100 MB (including indexes) — fits; but logging **every keystroke and raw scroll/pan/mousemove** will blow past 500 MB.
- **Logging discipline** (each item maps to a risk point):
  - Debounce typing — record a length on send or after a pause, **never one row per key**.
  - Throttle or simply skip high-frequency view events (scroll / pan / mousemove).
  - Keep `action_content` compact; attach `context_snapshot` only to `send_message` / `receive_response`, not every row.
  - **Reference** nodes by `node_id` rather than copying conversation history into logs (§6.2).
- **Egress (5 GB) is comfortable, but**: when polling for new branches, fetch **deltas only** (nodes created since the last timestamp), not the whole tree each time; LLM token streams go through your own proxy and **not through Supabase**, so they don't count against its egress.
- **Escape hatch**: if logs approach the limit, treat the DB as a **rolling buffer** — periodically export `user_action_logs` to CSV and delete rows older than a few days. The CSVs become your research archive, the DB stays small, and 500 MB stops mattering. With this pattern, the free tier is genuinely enough.
- **Ops reminder**: there's daily traffic during the study, so the "7-day inactivity auto-pause" won't trigger; add a scheduled ping if there's ever a quiet gap.

---

## 7. Data Persistence, Backup & Research Export

- **Persist immediately**: each node is written to Postgres the moment it completes; the client holds no sole copy of state. Refresh / crash loses nothing, and the stateless frontend can be hot-fixed and redeployed anytime.
- **Backup (important)**: **the free tier has no automatic backups** — so schedule your own periodic `pg_dump` / table-level CSV exports (a scheduled GitHub Actions job works). This database is your research dataset; an accidental delete, a bad migration, or a billing pause must not be able to end the study.
- **Research export**: during analysis, connect to Postgres with a read-only account and export `nodes / reactions / user_action_logs / team_interaction_logs` to CSV for your analysis scripts.
- **LLM failure handling**: add a retry plus a clear error state to proxy calls, so a silently dropped response doesn't pollute a conversation.

---

## 8. Concurrency & Conflict Handling

**Core principle: an append-only, immutable node tree structurally eliminates most conflicts.** This is exactly why the Git-style model fits — most "conflicts" simply cannot occur in this data model.

### 8.1 Conflicts that cannot happen structurally (nothing to handle)

- **Two people forking the same node at once**: each creates an independent child (distinct `id`), the tree just gains two children — no overwrite, no loss. Concurrent forks are two independent inserts.
- **Two people replying to the same node at once**: again, two children of one parent; the branch simply splits. The only thing to handle is UX (a hint like "someone else also continued from here"), not data.
- **Editing the same node**: impossible — nodes are immutable. This single property removes the entire hardest class of collaborative conflicts, "edit conflicts" (no CRDT, no OT needed).
- **Out-of-order events / missed realtime updates**: don't corrupt anything, because the tree is **reconstructed** from `parent_id`, not from the order events arrive. A client that briefly misses an insert self-heals on the next delta fetch.

### 8.2 Low-contention mutable items (simple rules suffice)

- **Visibility toggle**: restrict it to the **node's author only** → a single writer, so last-write-wins is fine and no one fights over one node's visibility. Add `author_id = auth.uid()` to the RLS update policy.
- **Reaction buttons**: the `unique(node_id, user_id, type)` constraint absorbs duplicate clicks — a duplicate insert is rejected by the database.

### 8.3 Things you do need to handle actively

| Risk | How to handle |
|---|---|
| Interrupted LLM stream | **Write the user node first** (the turn is never lost); on failure mark the turn `errored` and offer a **retry**, never leaving a dangling user node with no answer |
| Duplicate log batches (`sendBeacon` / reconnect) | Generate a **UUID** per log row client-side and `upsert` by id, so retries don't double-insert |
| Realtime / delta-fetch reconnect | After fetching, **`upsert` by `node_id`** (idempotent) so reconnects don't double-insert or flicker |
| Concurrent write ordering | Rely on DB timestamps + foreign keys; write a node in a single transaction, with `parent_id` required to already exist (the FK guarantees you can't attach to a non-existent parent) |
| Same user, multiple tabs / devices | Distinguish with `session_id`; nodes and logs both carry `author_id`, so they never overwrite each other |

### 8.4 On "merge"

This system has **no merge operation** — branches only diverge, they don't rejoin, so there are **no Git-style merge conflicts to resolve at all**. For the study this is a **feature, not a gap**: divergence and parallel exploration are exactly what RQ2 sets out to observe. If you later want a "bring two branches back together" capability, that's a genuine design problem of its own (how to reconcile two contexts) and is out of scope as the system stands.

### 8.5 Social disagreement (study-design level)

Beyond data conflicts, there's the "soft conflict" of teammates **disagreeing or forking in incompatible directions**. The system **does not resolve disagreement; it makes it visible and negotiable**:

- 📌pin / 💬let's discuss / 🔗built-on reaction buttons turn a disagreement into a **discussable object** (DG4). `discuss_request` goes into `team_interaction_logs`, marking a team-negotiation trigger.
- The shared tree makes "who builds on whom, who routed around whose direction" visible; `team_interaction_logs(actor, target)` records these for analyzing the negotiation process.
- Private-by-default + selective sharing (DG3) lowers the social cost of exposing exploratory ideas too early, letting disagreement enter the team boundary **when ready** rather than being suppressed.

This part is research design more than engineering, but the system supports it through the mechanisms above and leaves a complete trace of the process in the logs.

---

## 9. Deployment & Operations

- Deploy the frontend + Nitro together on Vercel; use a Supabase cloud project.
- Add a **read-only admin view** (recent activity per team) to spot a stuck participant or a broken feature during the weekly check-ins.
- **Pilot it on your own team for a few days before week 0** — deployment-level bugs that only surface in multi-user sessions won't show up in solo testing.
- Scale check: 10 concurrent users ≈ at most 10 concurrent LLM calls, negligible DB load, no queues / load balancers needed.

---

## 10. Implementation Priority

1. Schema + RLS (§5) → get the nodes tree and lineage query working.
2. LLM proxy + SSE (§2.2) → one person can chat with the agent and persist it.
3. Realtime subscriptions + Vue Flow tree (§2.1) → multiple people can see each other's branches.
4. Forking + visibility + reactions (DG1–DG4).
5. **Concurrency idempotency (§8.3)** — single-transaction node writes, UUID/`upsert` for logs and delta fetches, author-only visibility; do this when the multi-user features ship, which is far cheaper than chasing race conditions afterward.
6. **Action / team-interaction logging (§6)** — build it in parallel with the features; be sure to instrument each action as it ships, since back-filling is extremely hard.
7. Admin view + backup script + self-pilot run.
