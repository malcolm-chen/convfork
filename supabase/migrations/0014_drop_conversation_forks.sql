-- Revert 0013. The "fork = new conversation (project)" model was abandoned in
-- favor of forking as a new branch/chat within the same conversation, so these
-- provenance columns are unused. Dropping each column also drops its FK
-- constraint and comment; dropping forked_from_conversation_id also drops any
-- index on it. `if exists` keeps this idempotent and safe on a fresh `db reset`
-- (where 0013 created the columns) and on the already-migrated remote alike.

drop index if exists idx_conv_forked_from;

alter table conversations
  drop column if exists forked_from_conversation_id,
  drop column if exists forked_from_node_id,
  drop column if exists forked_from_label,
  drop column if exists forked_seed_tip_id;
