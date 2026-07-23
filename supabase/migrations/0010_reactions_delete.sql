-- Allow a user to remove their own reaction (toggle un-react / unpin).
-- Without this, the client can only INSERT, so re-clicking a reaction no-ops.
create policy reactions_delete on reactions for delete
  using (user_id = auth.uid());
