-- Study credentials: participants log in with study_user_id + session_id.
-- Users who share the same session_id are placed on the same team.

alter table teams
  add column if not exists session_id text;

create unique index if not exists teams_session_id_uidx
  on teams (session_id)
  where session_id is not null;

alter table users
  add column if not exists study_user_id text;

create unique index if not exists users_study_user_id_uidx
  on users (study_user_id)
  where study_user_id is not null;

comment on column teams.session_id is 'Study session code; shared session_id ⇒ same team';
comment on column users.study_user_id is 'Participant-facing login ID (not auth.users UUID)';
