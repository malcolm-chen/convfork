// Clear a conversation tree: deletes every node (all authors' branches) and
// their reactions, keeping the conversation itself. Any team member may clear,
// mirroring /api/chat's membership rule.

export default defineEventHandler(async (event) => {
  const body = await readBody<{ conversationId: string }>(event)
  const { admin } = await requireConversationMember(event, body?.conversationId)
  const cleared = await purgeConversationNodes(admin, body.conversationId)
  return { cleared }
})
