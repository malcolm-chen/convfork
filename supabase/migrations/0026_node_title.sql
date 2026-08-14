-- Canvas card headline for a "conversation node" (segment/branch, identified
-- by its head node's id — see composables/useSegments.ts). Previously this
-- was an LLM-generated summary cached client-only (localStorage), invisible
-- to teammates and reset per browser; it's now a real column so both the
-- auto-generated title and a user's manual rename are shared and arrive over
-- the existing nodes UPDATE realtime subscription (composables/useRealtime.ts).
--
-- Neither column is in enforce_node_immutability()'s protected list (see
-- 0003_rls.sql), so updating them after insert is allowed.
alter table nodes add column title text;

-- Set once a human explicitly renames the card — from then on, an
-- auto-generated summary must never overwrite their choice (see
-- server/api/nodes/rename.post.ts).
alter table nodes add column title_manual boolean not null default false;

-- Content hash (composables/useNodeSummaries.ts's cyrb53) the auto title was
-- generated from, so a client can tell whether the segment has grown since
-- and it's worth asking the model for a fresh title, without re-summarizing
-- on every render.
alter table nodes add column title_hash text;
