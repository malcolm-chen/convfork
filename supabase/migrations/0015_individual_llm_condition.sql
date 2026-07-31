-- Third study condition: individual_llm — each participant chats with the
-- LLM alone. No team panel, no shared canvas, no sharing controls in the UI.

alter table teams drop constraint if exists teams_sharing_condition_check;
alter table teams
  add constraint teams_sharing_condition_check
  check (sharing_condition in ('default', 'selective_sharing', 'individual_llm'));

comment on column teams.sharing_condition is
  'Study condition: default (auto-public), selective_sharing (private + opt-in share), or individual_llm (solo chat, sharing disabled)';

-- Defense in depth alongside the UI: block nodes from ever becoming shared
-- under individual_llm, even though the UI never exposes a share control there.
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
  elsif cond = 'individual_llm' and new.visibility = 'shared' then
    raise exception 'Cannot share nodes under the individual_llm condition';
  end if;
  return new;
end;
$$;
