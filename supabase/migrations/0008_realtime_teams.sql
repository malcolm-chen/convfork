-- Realtime for the membership flow so nobody has to manually refresh:
--   • users  → an admitted member's own row gets team_id set; their session
--              receives the UPDATE and auto-lands in the team. Teammates also
--              see the new member appear.
--   • team_join_requests → members watch requests arrive/clear live.
--
-- RLS-over-realtime only delivers rows a client may SELECT. users already has a
-- self/same-team SELECT policy (0003). team_join_requests had NO client policy
-- (server-only), so add a read-only SELECT policy for team members + the
-- requester — enough for realtime delivery. Writes stay server-only (still no
-- INSERT/UPDATE/DELETE policy), so the approval path is unchanged.

alter publication supabase_realtime add table users;
alter publication supabase_realtime add table team_join_requests;

create policy tjr_select on team_join_requests for select
  using (user_id = auth.uid() or team_id = auth_team_id());
