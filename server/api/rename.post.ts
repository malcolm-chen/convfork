// Rename a project. Server-side because RLS gives clients no UPDATE policy on
// conversations; membership is checked the same way as /api/chat.

export default defineEventHandler(async (event) => {
  const body = await readBody<{ conversationId: string; title: string }>(event)
  const title = body?.title?.trim()
  if (!title) throw createError({ statusCode: 400, statusMessage: 'title required' })
  if (title.length > 120) throw createError({ statusCode: 400, statusMessage: 'title too long (max 120 chars)' })

  const { admin } = await requireConversationMember(event, body?.conversationId)

  const { error } = await admin.from('conversations').update({ title }).eq('id', body.conversationId)
  if (error) throw createError({ statusCode: 500, statusMessage: `rename: ${error.message}` })

  return { ok: true }
})
