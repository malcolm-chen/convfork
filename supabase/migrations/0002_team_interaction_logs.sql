-- Cross-member interaction log (design doc §5.3) — the de-noised RQ2 source.
-- Small + analysis-critical, so it stays in Postgres (directly SQL-queryable).
-- The high-volume fine-grained user_action stream goes to S3, NOT here.

create table team_interaction_logs (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  team_id           uuid not null references teams(id),
  conversation_id   uuid references conversations(id),

  actor_user_id     uuid not null references users(id),   -- who initiated
  target_user_id    uuid references users(id),            -- whose artifact was acted on

  interaction_type  text not null,                        -- fork_from_other | share_to_team |
                                                          -- view_other_branch | react_to_other |
                                                          -- built_on | discuss_request
  source_node_id    uuid references nodes(id),            -- node forked / reacted to
  result_node_id    uuid references nodes(id),            -- new node produced by the fork
  metadata          jsonb not null default '{}'
);
create index idx_til_team   on team_interaction_logs(team_id, ts);
create index idx_til_actor  on team_interaction_logs(actor_user_id, ts);
create index idx_til_target on team_interaction_logs(target_user_id, ts);
create index idx_til_type   on team_interaction_logs(interaction_type, ts);
