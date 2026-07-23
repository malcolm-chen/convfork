-- Realtime broadcast for team awareness (design doc §6.1).
-- Only nodes + reactions. NOT team_interaction_logs (research data).

alter publication supabase_realtime add table nodes;
alter publication supabase_realtime add table reactions;

-- Full row image on UPDATE so private→shared visibility flips broadcast with
-- enough detail for clients to reconcile (the delta-fetch path in useRealtime).
alter table nodes replica identity full;
