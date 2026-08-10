// Mints a public, read-only share link over a single lineage (root -> the
// node the caller was viewing). individual_llm only: that's the one
// condition with no team-visible canvas/sharing, so a share link is the only
// way to hand a conversation to someone outside it — see
// pages/conversation/[id].vue's share button.

interface Body {
  conversationId: string
  nodeId: string
}

export default defineEventHandler(async (event) => {
  const { user, admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  if (!body?.conversationId || !body?.nodeId) {
    throw createError({ statusCode: 400, statusMessage: 'conversationId and nodeId required' })
  }

  const { data: team } = await admin.from('teams').select('sharing_condition').eq('id', teamId).single()
  if (team?.sharing_condition !== 'individual_llm') {
    throw createError({ statusCode: 403, statusMessage: 'share links are only available in the individual condition' })
  }

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', body.conversationId)
    .single()
  if (!convo || convo.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'conversation is not on your team' })
  }

  const { data: node } = await admin.from('nodes').select('id, conversation_id').eq('id', body.nodeId).single()
  if (!node || node.conversation_id !== body.conversationId) {
    throw createError({ statusCode: 400, statusMessage: 'node is not part of this conversation' })
  }

  const { data: share, error } = await admin
    .from('conversation_shares')
    .insert({ conversation_id: body.conversationId, node_id: body.nodeId, created_by: user.id })
    .select('id')
    .single()
  if (error || !share) {
    throw createError({ statusCode: 500, statusMessage: `create share: ${error?.message}` })
  }

  return { id: share.id as string }
})
