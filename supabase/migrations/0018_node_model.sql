-- Assistant nodes record which model backbone generated them, shown as a
-- small badge next to the AI avatar in the thread. Null for user nodes.
alter table nodes add column model text;
