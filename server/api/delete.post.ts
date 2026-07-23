// Delete a project outright: its nodes, their reactions, and the conversation
// row itself. Interaction-log rows are study data — they survive with their
// conversation/node references nulled (schema has no cascades).

export default defineEventHandler(async (event) => {
  const body = await readBody<{ conversationId: string }>(event)
  const { admin } = await requireConversationMember(event, body?.conversationId)

  await purgeConversationNodes(admin, body.conversationId)

  const { error: logErr } = await admin
    .from('team_interaction_logs')
    .update({ conversation_id: null })
    .eq('conversation_id', body.conversationId)
  if (logErr) throw createError({ statusCode: 500, statusMessage: `detach logs: ${logErr.message}` })

  const { error } = await admin.from('conversations').delete().eq('id', body.conversationId)
  if (error) throw createError({ statusCode: 500, statusMessage: `delete conversation: ${error.message}` })

  return { ok: true }
})
