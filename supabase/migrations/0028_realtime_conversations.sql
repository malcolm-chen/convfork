-- conversations ("projects") was never added to the realtime publication, so
-- teammates could never learn about a new project over postgres_changes no
-- matter what the client subscribed to — they had to navigate/refresh to
-- re-fetch the list (mirrors 0004/0008's realtime-for-team-awareness intent).
-- conversations_select RLS (team_id = auth_team_id(), see 0003) already scopes
-- delivery correctly, same as it does for users/team_join_requests.

alter publication supabase_realtime add table conversations;
