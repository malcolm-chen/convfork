-- Concept tagging: an LLM-assigned, per-conversation vocabulary of short topic
-- labels ("concepts") reused across segments so the canvas's topic filter has
-- a consistent, groupable set of options rather than one-off wording per card.
-- Scoped to a single conversation (project), same unit as merged_context_nodes
-- (see 0020_fix_merge_context_unit.sql) — not shared across a whole team.

create table concepts (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  name            text not null,
  description     text not null default '',
  usage_count     int not null default 0,
  created_at      timestamptz not null default now()
);
create index idx_concepts_conversation on concepts(conversation_id);
-- Cheap duplicate backstop (case/whitespace-insensitive) — not semantic
-- dedup (no embeddings infra in this deployment). A unique-violation on
-- insert is handled in code by falling back to the existing row.
create unique index idx_concepts_conv_name_ci on concepts(conversation_id, lower(name));

-- Whether a segment's current shared content has already been tagged, kept
-- separate from segment_concepts' row count since a segment can legitimately
-- have zero salient concepts — that still counts as "tagged" and shouldn't
-- be retried on every view.
create table segment_concept_state (
  segment_head_node_id uuid primary key references nodes(id),
  content_hash          text not null,
  tagged_at             timestamptz not null default now()
);

create table segment_concepts (
  id                   uuid primary key default gen_random_uuid(),
  segment_head_node_id uuid not null references nodes(id),
  concept_id           uuid not null references concepts(id) on delete cascade,
  score                numeric not null check (score >= 0 and score <= 1),
  created_at           timestamptz not null default now(),
  unique (segment_head_node_id, concept_id)
);
create index idx_sc_segment on segment_concepts(segment_head_node_id);
create index idx_sc_concept on segment_concepts(concept_id);

alter table concepts              enable row level security;
alter table segment_concept_state enable row level security;
alter table segment_concepts      enable row level security;

create policy concepts_select on concepts for select
  using (conversation_id in (select id from conversations where team_id = auth_team_id()));

create policy segment_concept_state_select on segment_concept_state for select
  using (segment_head_node_id in (select id from nodes));

create policy segment_concepts_select on segment_concepts for select
  using (concept_id in (select id from concepts));

-- No client insert/update policy on any of the three tables — written only
-- by the service_role admin client in server/api/concepts/assign.post.ts,
-- same convention as merged_context_nodes/merged_context_sources.

-- Atomic increment (avoids a read-then-write race across concurrently
-- tagged segments reusing the same concept).
create or replace function increment_concept_usage(concept_id uuid)
returns void language sql as $$
  update concepts set usage_count = usage_count + 1 where id = concept_id
$$;
