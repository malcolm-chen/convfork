-- A merged_context_sources.segment_head_node_id created before this fix can
-- point to a private node: with selective per-turn sharing, a segment's true
-- head is whatever node its own segmentize() run landed on for the merge's
-- creator, which can be a turn the author never shared. Every OTHER team
-- member's client never loads that node at all (RLS), so
-- ReasoningTree.vue's relayout() can never find it among their own visible
-- segments — the merge's incoming edge (and, before this fix, its layout
-- inclusion) silently drops for everyone but the creator. See
-- server/api/merge/create.post.ts, which now rejects a private head going
-- forward, and composables/useSegments.ts's firstSharedNodeId, which the
-- client now sends instead.
--
-- Retarget existing rows to the first *shared* node on the path from that
-- head to its frozen tip (included_through_turn_id) — the same node the
-- client would have sent had this fix existed at creation time, and the
-- same slice server/utils/mergedContext.ts already treats as the start of
-- the segment's shared content.
do $$
declare
  r record;
  new_head uuid;
begin
  for r in
    select mcs.merged_node_id, mcs.segment_head_node_id, mcs.included_through_turn_id
    from merged_context_sources mcs
    join nodes h on h.id = mcs.segment_head_node_id
    where h.visibility <> 'shared'
  loop
    select n.id into new_head
    from (
      with recursive lineage as (
        select * from nodes where id = r.included_through_turn_id
        union all
        select p.* from nodes p join lineage l on p.id = l.parent_id
      )
      select * from lineage
    ) n
    where n.visibility = 'shared'
      and n.created_at >= (select created_at from nodes where id = r.segment_head_node_id)
    order by n.created_at asc
    limit 1;

    if new_head is not null then
      update merged_context_sources
      set segment_head_node_id = new_head
      where merged_node_id = r.merged_node_id
        and segment_head_node_id = r.segment_head_node_id;
    end if;
  end loop;
end $$;
