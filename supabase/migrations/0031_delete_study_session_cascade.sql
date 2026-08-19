-- Delete an entire study session (team + all its content), called from
-- server/api/admin/sessions.delete.ts BEFORE removing member auth users and
-- the teams row itself — same cleanup-then-cascade shape as delete_study_user
-- (0024_delete_study_user_cascade.sql), but scoped to every conversation/user
-- on the team at once rather than one user's own content.
--
-- Unlike delete_study_user, this is a full wipe (the whole session is gone),
-- so there's no reparenting or attribution-preserving nulling: every row
-- that only exists inside this team's conversations is deleted outright.
-- Once this returns and the team's members/team row are gone, session_id is
-- free again — re-provisioning it (users.post.ts) creates a brand-new team,
-- so a researcher can pick a different sharing_condition for it.

create or replace function delete_study_session(target_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_ids uuid[];
  node_ids uuid[];
begin
  -- Logs reference nodes (source_node_id/result_node_id) with no cascade —
  -- clear them before nodes are dropped. The whole session is being wiped,
  -- so (unlike delete_study_user) these rows are deleted outright rather
  -- than having just their node pointers nulled.
  delete from team_interaction_logs where team_id = target_team;

  -- decided_by has no cascade either; a team member may have decided a join
  -- request for some OTHER team (browsing teams to join is unrestricted,
  -- see 0007_team_join_requests.sql), so clear that attribution before the
  -- member's auth user is deleted.
  update team_join_requests set decided_by = null
    where decided_by in (select id from users where team_id = target_team);

  select array_agg(id) into conv_ids from conversations where team_id = target_team;
  if conv_ids is null then
    return;
  end if;

  select array_agg(id) into node_ids from nodes where conversation_id = any(conv_ids);

  if node_ids is not null then
    delete from attachments where node_id = any(node_ids);
    delete from reactions where node_id = any(node_ids);
    delete from segment_concepts where segment_head_node_id = any(node_ids);
    delete from segment_concept_state where segment_head_node_id = any(node_ids);
    delete from merged_context_sources
      where segment_head_node_id = any(node_ids)
         or included_through_turn_id = any(node_ids);
    delete from conversation_shares where node_id = any(node_ids);
  end if;

  -- One statement for the whole conversation set: parents and children go
  -- together, satisfying nodes' self-referencing parent_id FK (same caution
  -- as purgeNodesByIds, server/utils/conversations.ts).
  delete from nodes where conversation_id = any(conv_ids);

  delete from merged_context_nodes where conversation_id = any(conv_ids);
  delete from concepts where conversation_id = any(conv_ids);
  delete from conversations where id = any(conv_ids);
end;
$$;

revoke execute on function delete_study_session(uuid) from public, anon, authenticated;
