-- Slack-style team membership: signups land team-less, browse all teams, and
-- request to join; any existing member of that team can admit (or reject) them.
-- Approval sets the requester's users.team_id (done server-side with the secret
-- key, since users has no client UPDATE policy and changing another user's row
-- must never be client-trusted).

create table team_join_requests (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references users(id),
  -- one live request per (team,user); re-requesting after a decision upserts.
  unique (team_id, user_id)
);
create index idx_tjr_team on team_join_requests(team_id, status);
create index idx_tjr_user on team_join_requests(user_id, status);

-- Browsing teams to join requires reading teams you're NOT a member of yet, so
-- broaden SELECT: any authenticated user may list teams (names only are exposed;
-- 0003's teams_select stays for parity but this permissive policy is OR'd in).
create policy teams_select_all on teams for select
  using (auth.uid() is not null);

-- team_join_requests: like team_interaction_logs, all reads/writes go through
-- server endpoints using the secret key (which bypasses RLS). Enable RLS with no
-- client policies so the anon/publishable client can never touch it directly.
alter table team_join_requests enable row level security;
