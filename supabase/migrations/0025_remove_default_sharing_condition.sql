-- Retire the 'default' (auto-public) study condition. Only selective_sharing
-- (private + opt-in share) and individual_llm (solo chat, sharing disabled)
-- remain; selective_sharing is the fallback wherever 'default' used to be.

update teams set sharing_condition = 'selective_sharing' where sharing_condition = 'default';

alter table teams drop constraint if exists teams_sharing_condition_check;
alter table teams
  add constraint teams_sharing_condition_check
  check (sharing_condition in ('selective_sharing', 'individual_llm'));

comment on column teams.sharing_condition is
  'Study condition: selective_sharing (private + opt-in share) or individual_llm (solo chat, sharing disabled)';

-- Auto-public forcing (the 'default' branch) is gone — nodes now always
-- start private (see chat.post.ts); only the individual_llm share-block
-- remains as defense in depth alongside the UI.
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

  if cond = 'individual_llm' and new.visibility = 'shared' then
    raise exception 'Cannot share nodes under the individual_llm condition';
  end if;
  return new;
end;
$$;
