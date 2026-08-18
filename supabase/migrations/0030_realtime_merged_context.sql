-- merged_context_nodes/merged_context_sources were never added to the
-- realtime publication (unlike nodes/reactions in 0004) — so no client
-- subscription, however written, could ever receive a postgres_changes event
-- for a new (or deleted) merge. Teammates only ever saw a freshly created
-- merged node after a manual reload, when useMergedNodes.ts's refresh()
-- re-ran on mount. mcn_select/mcs_select (0020) already scope delivery to
-- the viewer's own team, same as conversations (0028).

alter publication supabase_realtime add table merged_context_nodes;
alter publication supabase_realtime add table merged_context_sources;
