-- study_user_id was globally unique, which forced the same userID (e.g.
-- "Alice") to be usable in only one study session ever. It must only be
-- unique within a session's team — "Alice" in session1 and "Alice" in
-- session2 are separate participants with their own row.

drop index if exists users_study_user_id_uidx;

create unique index if not exists users_study_user_id_team_uidx
  on users (study_user_id, team_id)
  where study_user_id is not null and team_id is not null;

comment on index users_study_user_id_team_uidx is
  'study_user_id is only unique per team (i.e. per study session), not globally';
