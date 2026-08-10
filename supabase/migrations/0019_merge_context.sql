-- Merge Conversations feature: a merged context node aggregates snapshots of
-- several source conversations (each frozen at a cutoff node, per the
-- created_at <= cutoff trick already used for reconstruction elsewhere, see
-- design doc §6.2) so a later fork can seed a brand-new conversation with
-- all of them as inherited context, without copying turns into real nodes.

create table merged_context_nodes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  title       text not null,
  summary     text not null default '',
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);
create index idx_mcn_team on merged_context_nodes(team_id);

create table merged_context_sources (
  id                       uuid primary key default gen_random_uuid(),
  merged_node_id           uuid not null references merged_context_nodes(id) on delete cascade,
  conversation_id          uuid not null references conversations(id),
  author_id                uuid not null references users(id),
  -- Freeze point: the snapshot is every shared node in this conversation with
  -- created_at <= this node's created_at. Using a timestamp cutoff (rather
  -- than a single lineage walk) generalizes to conversations with multiple
  -- branches, and continuing the source conversation afterward can't
  -- silently change what was merged.
  included_through_turn_id uuid not null references nodes(id),
  created_at               timestamptz not null default now(),
  unique (merged_node_id, conversation_id)
);
create index idx_mcs_merged on merged_context_sources(merged_node_id);
create index idx_mcs_conv   on merged_context_sources(conversation_id);

-- A conversation forked from a merged node carries a reference back to it;
-- the inherited content is re-assembled at read time (LLM context + chat
-- panel), never copied into this conversation's own nodes.
alter table conversations add column parent_merged_node_id uuid references merged_context_nodes(id);
create index idx_conversations_parent_merged on conversations(parent_merged_node_id);

alter table merged_context_nodes   enable row level security;
alter table merged_context_sources enable row level security;

create policy mcn_select on merged_context_nodes for select
  using (team_id = auth_team_id());

create policy mcs_select on merged_context_sources for select
  using (merged_node_id in (select id from merged_context_nodes));

-- No client insert/update policy on either table: both are written only by
-- the service_role admin client in server/api/merge/create.post.ts, which
-- validates team membership and "has shared content" across every source
-- conversation before writing — the same pattern already used for
-- team_interaction_logs and the other cross-row-validated writes in this
-- codebase (chat.post.ts, clear.post.ts, rename.post.ts). Both tables are
-- otherwise immutable after creation, matching the nodes philosophy.
