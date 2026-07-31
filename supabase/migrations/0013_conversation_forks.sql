-- "Fork" now creates a brand-new conversation (seeded with a copy of the
-- prior context) instead of branching within the same tree. These columns
-- record that provenance. `on delete set null` on all three FKs so deleting
-- the origin conversation/node never blocks (or breaks) a fork that outlived it.
--
-- NOTE: this "fork = new conversation" model was abandoned in favor of forking
-- as a new branch/chat within the same conversation. These columns are unused
-- and are dropped again in 0014. The migration is kept (not deleted) so local
-- files match the already-applied remote migration history.

alter table conversations
  add column if not exists forked_from_conversation_id uuid references conversations(id) on delete set null,
  add column if not exists forked_from_node_id uuid references nodes(id) on delete set null,
  add column if not exists forked_from_label text,
  add column if not exists forked_seed_tip_id uuid references nodes(id) on delete set null;

comment on column conversations.forked_from_conversation_id is
  'Source conversation this one was forked from, if any.';
comment on column conversations.forked_from_node_id is
  'The node (in the source conversation) that was forked from.';
comment on column conversations.forked_from_label is
  'Frozen "C{n}-{turn}" display snapshot of the fork origin, computed once at fork time (shared-order numbering can shift later as more segments get shared).';
comment on column conversations.forked_seed_tip_id is
  'The id, in THIS conversation, of the last copied node — marks where the copied prior context ends and new messages begin.';
