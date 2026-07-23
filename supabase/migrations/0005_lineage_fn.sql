-- Lineage reconstruction (design doc §5.1). Walks parent_id from a node to the
-- root, ordered oldest→newest. SECURITY INVOKER so RLS applies for client calls;
-- the server proxy calls it with the service_role key (RLS bypassed).

create or replace function get_lineage(target uuid)
returns setof nodes
language sql stable as $$
  with recursive lineage as (
    select * from nodes where id = target
    union all
    select n.* from nodes n join lineage l on n.id = l.parent_id
  )
  select * from lineage order by created_at;
$$;
