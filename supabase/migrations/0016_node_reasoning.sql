-- Assistant nodes generated with thinking enabled additionally store the
-- model's reasoning trace, shown collapsed in the thread UI (§ thinking
-- toggle). Null for user nodes and for assistant turns generated without
-- thinking.
alter table nodes add column reasoning text;
