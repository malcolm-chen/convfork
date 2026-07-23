# ConvFork

Collaborative LLM workspace for a 3-week field study (~10 users). A conversation
is a **tree of append-only, immutable message nodes**; a *fork* adds a child node
under any shared node. See [system-architecture-and-data-design.md](system-architecture-and-data-design.md)
for the design and the implementation plan for the build rationale.

## Stack

- **Frontend/app:** Nuxt 3 (Vue 3) + Vue Flow + Nitro server routes (Node/npm).
- **Data + realtime + auth:** managed **Supabase Cloud** (Postgres, Realtime, Auth, RLS).
- **LLM backbone:** **LiteLLM** proxy (OpenAI-compatible) — provider-agnostic, `.env`-configurable (default `claude-opus-4-8`).
- **Behavior logs + optional HTML/screenshots:** **AWS S3** (the small cross-member `team_interaction_logs` stays in Postgres).
- **Python tooling:** `uv` (LiteLLM proxy, account seeding, backups).

## Two environments

| Env | Tool | Used for |
|---|---|---|
| Node | `npm` | the Nuxt app + Nitro server routes |
| Python | `uv` | LiteLLM proxy, `scripts/seed_users.py`, `scripts/backup.py` |

## Setup

```bash
# 1. Secrets
cp .env.example .env            # fill in Supabase, LiteLLM, AWS values

# 2. Node deps
npm install

# 3. Python env (uv)
uv sync

# 4. Database — apply migrations to your Supabase project
#    Easiest: paste supabase/migrations/000*.sql in order into the SQL editor,
#    or use the Supabase CLI:
supabase link --project-ref <ref>
supabase db push

# 5. Pre-provision study accounts (creates teams + auth users + profiles)
cp scripts/participants.example.json scripts/participants.json   # edit as needed
uv run python scripts/seed_users.py        # prints credentials

# 6. LLM proxy (separate terminal / service)
uv run litellm --config litellm-config.yaml   # listens on :4000

# 7. App
npm run dev                                    # http://localhost:3000
# prod: npm run build && npm run start
```

## Verification checklist (maps to the plan's milestones)

- **M0 services:** Supabase Studio reachable; `curl $LITELLM_BASE_URL/v1/chat/completions -d '{"model":"claude-opus-4-8","stream":true,...}'` streams; S3 read/write works.
- **M1 DB/RLS:** in the SQL editor, impersonate a user — see own private + teammates' shared nodes, never another team's; cannot select `team_interaction_logs`. `select * from get_lineage('<leaf>')` returns root→leaf.
- **M3 streaming:** send a message — tokens stream progressively (Network tab shows chunks, not one blob); user + assistant nodes persist; **kill the tab mid-stream → the assistant node still lands**; behavior-log objects appear in S3.
- **M4 realtime:** two browsers / same team — A sends, B sees the node < ~1s without refresh; third browser / other team sees nothing; A shares a private node → it appears for B (delta-fetch path); B offline then reconnect → catches up, no dupes.
- **M5 collaboration:** B forks A's shared node → `team_interaction_logs` row `fork_from_other`; B reacts → `react_to_other`/`discuss_request`/`built_on`; A shares a branch → `share_to_team`; fork from a private node is rejected (403).
- **M6 ops:** `uv run python scripts/backup.py` produces a restorable dump; `/admin` (as a `researcher`) shows per-team activity.

## Key files

- `supabase/migrations/` — schema, RLS, realtime, lineage fn, interaction triggers.
- `server/api/chat.post.ts` — LLM proxy + SSE (disconnect-survival persistence).
- `server/utils/llm.ts` — LiteLLM call (the provider-agnostic seam).
- `server/api/logs.post.ts` + `composables/useActionLogger.ts` — S3 behavior logging.
- `composables/useRealtime.ts` — realtime subscribe + idempotent upsert + visibility delta-fetch.
- `components/tree/ReasoningTree.vue` — Vue Flow + dagre layout.
- `scripts/seed_users.py` / `scripts/backup.py` — uv-managed ops tooling.

## Notes

- Keys (new Supabase format): the browser holds only the **publishable key** (RLS-bound). The **secret key**, **LiteLLM**, and **AWS** keys live only in Nitro `server/`.
- Free-tier Supabase has **no automatic backups** — run `scripts/backup.py` on a schedule.
- Pilot with the full team for a few days before week 0 (multi-user bugs don't surface solo).
