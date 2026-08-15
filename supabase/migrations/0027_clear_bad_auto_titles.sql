-- server/api/summarize.post.ts used to silently return the literal string
-- 'Untitled branch' as if it were a real generated title whenever the model
-- returned empty/unparseable output. useNodeSummaries.ts / TreeNode.vue then
-- persisted that text via rename.post.ts exactly like any other auto-summary,
-- so it synced over realtime to the whole team and looked like a permanently
-- stuck "Untitled" card — and because title_hash matched the (unchanged)
-- transcript, TreeNode.vue's regenerate guard (`title && title_hash === key`)
-- refused to ever ask the model again for that node.
--
-- summarize.post.ts now throws instead of returning the placeholder, so this
-- can't recur. Clear out any cards already stuck on it (never a human
-- rename, so safe to drop) — nulling title/title_hash lets the existing
-- watcher in TreeNode.vue regenerate it next time anyone views the card.
update nodes
set title = null, title_hash = null
where title = 'Untitled branch' and title_manual = false;
