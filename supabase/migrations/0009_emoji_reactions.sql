-- Reactions become free-form emoji (Slack-style) instead of the fixed
-- pin / discuss / built_on set. Drop the CHECK so `type` can hold any emoji
-- character. Existing rows (pin/discuss/built_on) remain valid.
--
-- The (node_id, user_id, type) uniqueness still holds — one of each emoji per
-- user per node. The cross-member interaction trigger (0006) already treats any
-- non-discuss/built_on type as 'react_to_other' and records the raw value in
-- metadata.reaction, so research capture is preserved for arbitrary emoji.
alter table reactions drop constraint if exists reactions_type_check;
