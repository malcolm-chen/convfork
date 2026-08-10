-- Public read-only share links (individual_llm condition only). A share
-- freezes a single lineage — root through the tip node the user was viewing
-- when they clicked "Share" — by reference. Nodes are already append-only
-- and immutable (0003_rls.sql), so that reference alone is enough to freeze
-- the content: continuing the source chat afterward can never change what a
-- visitor with the link already sees.
create table conversation_shares (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  node_id         uuid not null references nodes(id), -- tip of the shared lineage
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index idx_shares_conv on conversation_shares(conversation_id);

alter table conversation_shares enable row level security;

-- No client select/insert/update policy: visitors following a share link are
-- unauthenticated (RLS would block them outright), and the sharer isn't
-- reading this table directly either — both directions go through the
-- service_role admin client (server/api/share/create.post.ts validates the
-- individual_llm condition + team ownership before writing; the public
-- server/api/share/[id].get.ts and its attachment route read it), matching
-- the merged_context_sources pattern in 0019_merge_context.sql.
