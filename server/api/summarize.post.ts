// Auto-summarize a conversation trajectory into a short sidebar-style title
// (ChatGPT-like), so the tree cards show a gist instead of raw turns.
// Stateless: the client sends the trajectory transcript and gets back a title.
// Callers cache the result (see composables/useNodeSummaries).

import { MODEL_OPTIONS } from '#shared/models'

interface Body {
  text: string
  model?: string
}

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readBody<Body>(event)
  const text = (body?.text ?? '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text required' })

  // Bound the prompt: a title only needs the gist, not the whole branch.
  const clipped = text.slice(0, 6000)

  // Stay on whichever backbone the trajectory itself already used — falling
  // back to the global default only when the caller didn't send one — so
  // titling a branch never depends on a provider the team hasn't configured.
  const model = body.model && MODEL_OPTIONS.some((m) => m.id === body.model) ? body.model : undefined

  const summary = await completeLLM(
    [
      {
        role: 'system',
        content:
          'You label conversation branches for a sidebar, like ChatGPT chat titles. ' +
          'Given a transcript between a user and an assistant, reply with a single concise ' +
          'title of 3 to 7 words that captures the topic. Plain text only — no quotes, no ' +
          'trailing punctuation, no prefix like "Title:".',
      },
      { role: 'user', content: clipped },
    ],
    { model },
  )

  // Normalize: strip wrapping quotes/whitespace, collapse newlines, cap length.
  const clean = summary
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()
    .slice(0, 80)

  // Never hand back a placeholder as if it were a real title: the caller
  // (useNodeSummaries) persists whatever comes back over the realtime nodes
  // UPDATE (see server/api/nodes/rename.post.ts) and, once persisted, the
  // matching title_hash stops anyone from ever asking the model again — so a
  // silently-returned 'Untitled branch' here used to bake itself in as the
  // card's permanent title for the whole team. Throwing instead routes this
  // through useNodeSummaries' status:'error' path, which the card shows as a
  // transient shimmer/retry instead of writing anything to nodes.title.
  if (!clean) throw createError({ statusCode: 502, statusMessage: 'model returned an empty title' })

  return { summary: clean }
})
