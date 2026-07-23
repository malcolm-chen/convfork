-- Cross-member interaction logging (design doc §5.3) for client-side writes,
-- enforced via triggers so a client bug can't skip them. (fork_from_other is
-- written server-side in /api/chat, which already knows actor/target.)
-- Trigger fns are SECURITY DEFINER so they can write the RLS-protected log table.

-- Reaction on someone else's node → react_to_other / discuss_request / built_on.
create or replace function log_reaction_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n_author uuid;
  n_conv   uuid;
  n_team   uuid;
  itype    text;
begin
  select author_id, conversation_id into n_author, n_conv from nodes where id = NEW.node_id;
  if n_author is null or n_author = NEW.user_id then
    return NEW;  -- self-reaction is not a cross-member interaction
  end if;
  select team_id into n_team from conversations where id = n_conv;
  itype := case NEW.type
             when 'discuss'  then 'discuss_request'
             when 'built_on' then 'built_on'
             else 'react_to_other'
           end;
  insert into team_interaction_logs(
    team_id, conversation_id, actor_user_id, target_user_id,
    interaction_type, source_node_id, metadata)
  values (n_team, n_conv, NEW.user_id, n_author, itype, NEW.node_id,
          jsonb_build_object('reaction', NEW.type));
  return NEW;
end; $$;

create trigger trg_reaction_interaction
  after insert on reactions
  for each row execute function log_reaction_interaction();

-- Visibility flip private→shared → share_to_team (boundary-crossing timing).
create or replace function log_share_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n_team uuid;
begin
  if OLD.visibility = 'private' and NEW.visibility = 'shared' then
    select team_id into n_team from conversations where id = NEW.conversation_id;
    insert into team_interaction_logs(
      team_id, conversation_id, actor_user_id, target_user_id,
      interaction_type, source_node_id)
    values (n_team, NEW.conversation_id, NEW.author_id, null, 'share_to_team', NEW.id);
  end if;
  return NEW;
end; $$;

create trigger trg_share_interaction
  after update on nodes
  for each row execute function log_share_interaction();

-- Share a whole branch (a set of the caller's own nodes) in one statement.
-- SECURITY INVOKER → the author-only RLS update policy still applies.
create or replace function share_branch(node_ids uuid[])
returns void language sql security invoker as $$
  update nodes set visibility = 'shared'
  where id = any(node_ids) and author_id = auth.uid();
$$;
