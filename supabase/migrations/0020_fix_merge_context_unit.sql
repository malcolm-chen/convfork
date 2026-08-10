-- Course-correction on 0019 (no rows exist yet in either table — verified
-- before writing this — so it's safe to drop and recreate rather than layer
-- ALTERs): the mergeable unit is a "conversation node" — one segment/branch
-- card on a single project's canvas (see composables/useSegments.ts), not a
-- whole project. A merge only ever combines segments from the SAME project
-- (conversation_id), and forking a merged node creates a new segment (a
-- fresh root-level branch, parent_id null) inside that same project — never
-- a new top-level conversation row.

-- Drop the FK-holding column before the tables it references, or Postgres
-- refuses the drop (2BP01: dependent objects).
alter table conversations drop column if exists parent_merged_node_id;

drop policy if exists mcs_select on merged_context_sources;
drop policy if exists mcn_select on merged_context_nodes;
drop table if exists merged_context_sources;
drop table if exists merged_context_nodes;

-- A merged node belongs to exactly one project — all its source segments
-- live there too, by construction.
create table merged_context_nodes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  title           text not null,
  summary         text not null default '',
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index idx_mcn_conv on merged_context_nodes(conversation_id);

create table merged_context_sources (
  id                       uuid primary key default gen_random_uuid(),
  merged_node_id           uuid not null references merged_context_nodes(id) on delete cascade,
  -- A segment's stable identity is its head node's id (see Segment.id in
  -- useSegments.ts) — the fork point (or root) the segment's chain starts at.
  segment_head_node_id     uuid not null references nodes(id),
  author_id                uuid not null references users(id),
  -- Freeze point: this segment's tip node at merge time. Reconstruction
  -- walks parent_id from here back up to (and including) segment_head_node_id
  -- — a straight chain, since that's exactly what a segment is — so
  -- continuing that branch afterward can't silently change what was merged.
  included_through_turn_id uuid not null references nodes(id),
  created_at               timestamptz not null default now(),
  unique (merged_node_id, segment_head_node_id)
);
create index idx_mcs_merged on merged_context_sources(merged_node_id);

-- Marks a node as the head of a new segment created by forking a merged
-- node (only ever set at INSERT, on a fresh root-level node — parent_id
-- null — in the same conversation_id the merged node itself belongs to).
alter table nodes add column parent_merged_node_id uuid references merged_context_nodes(id);

alter table merged_context_nodes   enable row level security;
alter table merged_context_sources enable row level security;

create policy mcn_select on merged_context_nodes for select
  using (conversation_id in (select id from conversations where team_id = auth_team_id()));

create policy mcs_select on merged_context_sources for select
  using (merged_node_id in (select id from merged_context_nodes));

-- No client insert/update policy on either table — written only by the
-- service_role admin client in server/api/merge/create.post.ts, same as before.
