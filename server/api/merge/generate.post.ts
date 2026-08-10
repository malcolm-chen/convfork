// AI title + summary for a draft merge, over the shared content of several
// conversation nodes (segments) "as of right now" (no freeze yet — that only
// happens at create time, see merge/create.post.ts). Reused for both the
// initial generation and any "Regenerate" / selection-change re-roll.

interface Body {
  conversationId: string
  segments: { headNodeId: string; tipNodeId: string }[]
}

export default defineEventHandler(async (event) => {
  const { admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  const segments = body?.segments ?? []
  if (!body?.conversationId) throw createError({ statusCode: 400, statusMessage: 'conversationId required' })
  if (segments.length < 2) throw createError({ statusCode: 400, statusMessage: 'select at least 2 conversation nodes' })

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', body.conversationId)
    .single()
  if (!convo || convo.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'conversation is not on your team' })
  }

  const transcripts = await Promise.all(
    segments.map(async (s) => {
      const snapshot = await fetchSegmentSnapshot(admin, s.headNodeId, s.tipNodeId)
      const text = snapshot.map((m) => `${m.authorName}: ${m.content}`).join('\n\n')
      return text || '(no shared messages yet)'
    }),
  )

  const raw = await completeLLM([
    {
      role: 'system',
      content:
        'You label and summarize a set of merged conversation branches for a team workspace. ' +
        'Given several transcripts, reply with exactly two lines in this format, nothing else:\n' +
        'TITLE: <a concise 3 to 7 word title covering all of them>\n' +
        'SUMMARY: <1 to 3 sentences describing the main topics, ideas, or conclusions across them. Keep it within 30 words.>',
    },
    { role: 'user', content: transcripts.join('\n\n---\n\n').slice(0, 12000) },
  ], { maxTokens: 220 })

  const titleMatch = raw.match(/TITLE:\s*(.+)/i)
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)/i)
  const title = (titleMatch?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()
    .slice(0, 80)
  const summary = (summaryMatch?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)

  return {
    title: title || 'Untitled merge',
    summary: summary || 'Combines several conversation nodes.',
  }
})
