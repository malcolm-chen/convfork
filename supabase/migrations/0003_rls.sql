-- Row-level security (design doc §5.4) + node immutability enforcement (§1, §8.2).

-- Helper: current user's team, via SECURITY DEFINER to avoid recursive RLS on users.
create or replace function auth_team_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from users where id = auth.uid()
$$;

alter table teams                 enable row level security;
alter table users                 enable row level security;
alter table conversations         enable row level security;
alter table nodes                 enable row level security;
alter table reactions             enable row level security;
alter table team_interaction_logs enable row level security;

-- teams / users / conversations: scoped to the caller's own team. No client writes.
create policy teams_select on teams for select
  using (id = auth_team_id());

create policy users_select on users for select
  using (id = auth.uid() or team_id = auth_team_id());

create policy conversations_select on conversations for select
  using (team_id = auth_team_id());

create policy conversations_insert on conversations for insert
  with check (team_id = auth_team_id() and created_by = auth.uid());

-- nodes: see your own (any visibility) + teammates' shared nodes.
create policy nodes_select on nodes for select using (
  author_id = auth.uid()
  or (
    visibility = 'shared'
    and conversation_id in (
      select c.id from conversations c where c.team_id = auth_team_id()
    )
  )
);

-- write only as yourself
create policy nodes_insert on nodes for insert
  with check (author_id = auth.uid());

-- update only your own node (the immutability trigger restricts WHICH columns)
create policy nodes_update on nodes for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- reactions: visible iff the underlying node is visible (RLS on nodes cascades here).
create policy reactions_select on reactions for select
  using (node_id in (select id from nodes));

create policy reactions_insert on reactions for insert
  with check (user_id = auth.uid());

-- team_interaction_logs: research data — NO client select, NO client insert.
-- (Written server-side with the service_role key / via triggers, which bypass RLS.)

-- ── Node immutability: only `visibility` may ever change after insert ──
create or replace function enforce_node_immutability()
returns trigger language plpgsql as $$
begin
  if row(new.id, new.conversation_id, new.parent_id, new.author_id,
          new.role, new.content, new.is_fork_point, new.created_at)
     is distinct from
     row(old.id, old.conversation_id, old.parent_id, old.author_id,
          old.role, old.content, old.is_fork_point, old.created_at)
  then
    raise exception 'nodes are immutable; only visibility may change';
  end if;
  return new;
end; $$;

create trigger trg_nodes_immutable
  before update on nodes
  for each row execute function enforce_node_immutability();
