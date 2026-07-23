-- Experimental sharing condition for a study session (team).
-- default           → nodes always shared; participants cannot choose
-- selective_sharing → nodes private by default; participants choose what to share

alter table teams
  add column if not exists sharing_condition text not null default 'selective_sharing'
    check (sharing_condition in ('default', 'selective_sharing'));

comment on column teams.sharing_condition is
  'Study condition: default (auto-public) or selective_sharing (private + opt-in share)';

-- Force auto-public writes for the default condition (server + client cannot bypass).
create or replace function enforce_team_sharing_condition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cond text;
begin
  select t.sharing_condition into cond
  from conversations c
  join teams t on t.id = c.team_id
  where c.id = new.conversation_id;

  if cond = 'default' then
    if tg_op = 'INSERT' then
      new.visibility := 'shared';
    elsif new.visibility is distinct from old.visibility and new.visibility = 'private' then
      raise exception 'Cannot make nodes private under the default (auto-public) condition';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nodes_sharing_condition on nodes;
create trigger trg_nodes_sharing_condition
  before insert or update of visibility on nodes
  for each row execute function enforce_team_sharing_condition();
