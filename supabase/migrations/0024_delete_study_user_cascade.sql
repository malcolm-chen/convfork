-- Deleting a study user via admin/users.delete.ts calls auth.admin.deleteUser(),
-- which cascades into public.users (on delete cascade, see 0001). But every
-- table holding that user's own content references users(id) with NO cascade
-- (default NO ACTION), so deleting any participant who has actually used the
-- app — posted a turn, reacted, etc. — fails with a foreign-key violation,
-- surfaced to the admin UI as an opaque 500.
--
-- This adds delete_study_user(uuid), called once from admin/users.delete.ts
-- BEFORE auth.admin.deleteUser(), to fully remove that user's own content so
-- the subsequent cascade succeeds. Two things it deliberately does NOT do:
--   1. Delete a conversation/merge/share just because this user created it —
--      those objects can hold other members' content too, so their
--      created_by is nulled (attribution lost) instead of the object itself
--      being destroyed. Requires created_by to be nullable (altered below).
--   2. Delete a teammate's fork of this user's node — the child is reparented
--      to the nearest surviving ancestor (walking up past any run of this
--      user's own now-deleted nodes) instead, so it survives as if the
--      deleted node had never existed.

alter table conversations         alter column created_by drop not null;
alter table merged_context_nodes  alter column created_by drop not null;
alter table conversation_shares   alter column created_by drop not null;

create or replace function delete_study_user(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_nodes uuid[];
begin
  select array_agg(id) into target_nodes from nodes where author_id = target_user;

  if target_nodes is not null then
    -- Splice this user's nodes out of the tree: any surviving (other-author)
    -- child of one of these nodes gets re-pointed at the nearest ancestor
    -- that ISN'T also being deleted (NULL if that run reaches the root),
    -- so a teammate's fork is preserved rather than orphaned or destroyed.
    --
    -- trg_nodes_immutable (0003_rls.sql) rejects any change to parent_id —
    -- correct for normal app writes, but this reparenting is the one
    -- legitimate exception, so it's scoped off for just this statement
    -- (transactional DDL: rolls back with everything else on error, and is
    -- always re-enabled below before the function returns).
    alter table nodes disable trigger trg_nodes_immutable;
    with recursive surviving_ancestor(node_id, ancestor_id) as (
      select n.id, n.parent_id
      from nodes n
      where n.id = any(target_nodes)
      union all
      select sa.node_id, p.parent_id
      from surviving_ancestor sa
      join nodes p on p.id = sa.ancestor_id
      where p.id = any(target_nodes)
    )
    update nodes c
    set parent_id = sa.ancestor_id
    from (
      select node_id, ancestor_id
      from surviving_ancestor
      where ancestor_id is null or ancestor_id <> all(target_nodes)
    ) sa
    where c.parent_id = sa.node_id
      and c.author_id <> target_user;
    alter table nodes enable trigger trg_nodes_immutable;

    -- Rows that reference one of these nodes but aren't reparentable content
    -- of their own: gone with the node (reactions on it, its concept-tag
    -- cache, any merge snapshot or public share frozen on it), or just have
    -- that one pointer cleared if the row itself belongs to someone else
    -- (an interaction log entry).
    delete from reactions where node_id = any(target_nodes);
    delete from segment_concepts where segment_head_node_id = any(target_nodes);
    delete from segment_concept_state where segment_head_node_id = any(target_nodes);
    update team_interaction_logs set source_node_id = null where source_node_id = any(target_nodes);
    update team_interaction_logs set result_node_id = null where result_node_id = any(target_nodes);
    delete from merged_context_sources
      where segment_head_node_id = any(target_nodes)
         or included_through_turn_id = any(target_nodes);
    delete from conversation_shares where node_id = any(target_nodes);
  end if;

  -- Safe now: any surviving child has been reparented above, so this can't
  -- hit the self-referencing parent_id FK.
  delete from nodes where author_id = target_user;

  -- This user's own reactions on OTHER people's nodes.
  delete from reactions where user_id = target_user;

  -- Interaction logs this user initiated are specifically about them, so
  -- they go; logs where they were only the target belong to the (surviving)
  -- actor and just lose that one pointer.
  delete from team_interaction_logs where actor_user_id = target_user;
  update team_interaction_logs set target_user_id = null where target_user_id = target_user;

  delete from merged_context_sources where author_id = target_user;

  -- Attribution-only columns on objects that outlive this user.
  update conversations        set created_by = null where created_by = target_user;
  update merged_context_nodes set created_by = null where created_by = target_user;
  update conversation_shares  set created_by = null where created_by = target_user;
  update team_join_requests   set decided_by = null where decided_by = target_user;
  -- team_join_requests.user_id already cascades on delete (0007).
end;
$$;

revoke execute on function delete_study_user(uuid) from public, anon, authenticated;
