-- merged_context_nodes DELETE events were never actually reaching any
-- client: with the default replica identity (primary key only), a DELETE's
-- "old" row carries just `id`, but mcn_select (0020) filters on
-- conversation_id — a column Realtime can't evaluate the RLS policy against
-- when it's missing from the WAL record, so the event is dropped for every
-- subscriber, not just unauthorized ones. Same fix nodes already got in 0004
-- for the same reason (there, for UPDATE).

alter table merged_context_nodes replica identity full;
