// Tags one or more conversation nodes (segments) with up to 3 concepts each
// from this project's shared vocabulary, in a SINGLE LLM call covering every
// segment sent — see server/utils/concepts.ts for why this is batched
// rather than one call per segment (the earlier per-segment design let
// near-duplicate concepts slip through, since each request resolved its
// segment with no visibility into what other in-flight requests were
// deciding for theirs, and firing many of them in parallel also reliably
// tripped the LLM provider's rate limit).
//
// Content is fetched server-side via fetchSegmentSnapshot (shared-only)
// rather than trusting client-sent text — segment.nodes can include a
// teammate's not-yet-shared private turns (see composables/useSegments.ts's
// sharedSegments()), which must never reach an LLM call or a team-visible
// concept.

import { MODEL_OPTIONS } from '../../../shared/models'

interface Body {
  conversationId: string
  segments: { segmentHeadNodeId: string; tipNodeId: string }[]
  model?: string
}

export default defineEventHandler(async (event) => {
  const { admin, teamId } = await requireCallerTeam(event)
  const body = await readBody<Body>(event)
  if (!body?.conversationId || !body?.segments?.length) {
    throw createError({ statusCode: 400, statusMessage: 'conversationId and at least one segment required' })
  }

  const { data: convo } = await admin
    .from('conversations')
    .select('id, team_id')
    .eq('id', body.conversationId)
    .single()
  if (!convo || convo.team_id !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'conversation is not on your team' })
  }

  const nodeIds = body.segments.map((s) => s.segmentHeadNodeId)
  const { data: stateRows } = await admin
    .from('segment_concept_state')
    .select('segment_head_node_id, content_hash')
    .in('segment_head_node_id', nodeIds)
  const hashBySegment = new Map((stateRows ?? []).map((r: any) => [r.segment_head_node_id, r.content_hash as string]))

  // Cap each segment's transcript a bit tighter than the old single-segment
  // endpoint (6000 chars) since many segments now share one prompt.
  const PER_SEGMENT_CHARS = 3000
  const toTag: { id: string; transcript: string; hash: string }[] = []
  const unchangedIds: string[] = []
  for (const s of body.segments) {
    const shared = await fetchSegmentSnapshot(admin, s.segmentHeadNodeId, s.tipNodeId)
    if (!shared.length) continue // nothing shared yet — nothing to tag
    const hash = hashTranscript(shared)
    if (hashBySegment.get(s.segmentHeadNodeId) === hash) {
      unchangedIds.push(s.segmentHeadNodeId)
      continue
    }
    const transcript = shared.map((m) => `${m.authorName}: ${m.content}`).join('\n\n').slice(0, PER_SEGMENT_CHARS)
    toTag.push({ id: s.segmentHeadNodeId, transcript, hash })
  }

  const results = new Map<string, { id: string; name: string; description: string }[]>()

  if (unchangedIds.length) {
    const { data: currentRows } = await admin
      .from('segment_concepts')
      .select('segment_head_node_id, score, concepts(id, name, description)')
      .in('segment_head_node_id', unchangedIds)
      .order('score', { ascending: false })
    for (const id of unchangedIds) results.set(id, [])
    for (const row of (currentRows ?? []) as any[]) {
      if (!row.concepts) continue
      results.get(row.segment_head_node_id)!.push({ id: row.concepts.id, name: row.concepts.name, description: row.concepts.description })
    }
  }

  if (!toTag.length) {
    return { segments: Object.fromEntries(results) }
  }

  const model = body.model && MODEL_OPTIONS.some((m) => m.id === body.model) ? body.model : undefined

  // ── Phase 1: understand every segment being (re)tagged and propose
  // reuse/create decisions against a recent registry snapshot. Separate
  // prompt/parser for one segment vs many (see server/utils/concepts.ts) —
  // the batch framing is irrelevant noise for the single-segment case. Token
  // budgets are generous: these are reasoning models that spend real budget
  // on hidden reasoning tokens before ever writing the JSON (confirmed live
  // — a 4-segment batch used 512 reasoning tokens on top of ~280 of visible
  // output), so an undersized cap truncates the JSON and silently drops
  // whichever segments the model hadn't gotten to yet. ──
  const { data: registryRows } = await admin
    .from('concepts')
    .select('id, name, description')
    .eq('conversation_id', body.conversationId)
    .order('usage_count', { ascending: false })
    .limit(60)
  const registry = (registryRows ?? []) as { id: string; name: string; description: string }[]

  let decisionsBySegment: Map<string, ReturnType<typeof parseSingleConceptResponse>>
  if (toTag.length === 1) {
    const raw = await completeLLM(
      [{ role: 'user', content: buildSingleConceptPrompt(registry, toTag[0]!.transcript) }],
      { model, maxTokens: 1500 },
    )
    decisionsBySegment = new Map([[toTag[0]!.id, parseSingleConceptResponse(raw)]])
  } else {
    const raw = await completeLLM(
      [{ role: 'user', content: buildBatchConceptPrompt(registry, toTag) }],
      { model, maxTokens: Math.min(8000, 700 + 700 * toTag.length) },
    )
    decisionsBySegment = parseBatchConceptResponse(raw, toTag.map((s) => s.id))
  }

  // ── Phase 2 (serialized per conversation — see conversationLock.ts):
  // resolve every segment's decisions against a FRESH registry and commit.
  // All segments in this batch share one activeRegistry/byNormalizedName, so
  // two segments proposing the same new concept (by name) merge into one
  // row instead of creating a duplicate each. ──
  const batchResults = await withConversationLock(body.conversationId, async () => {
    const { data: freshRows } = await admin
      .from('concepts')
      .select('id, name, description')
      .eq('conversation_id', body.conversationId)
    const activeRegistry = (freshRows ?? []) as { id: string; name: string; description: string }[]
    const byNormalizedName = new Map(activeRegistry.map((c) => [normalizeConceptName(c.name), c]))
    const out = new Map<string, { id: string; name: string; description: string; score: number; isNew: boolean }[]>()

    for (const seg of toTag) {
      const decisions = decisionsBySegment.get(seg.id) ?? []
      const resolved: { id: string; name: string; description: string; score: number; isNew: boolean }[] = []

      for (const d of decisions) {
        if (d.action === 'reuse') {
          const c = activeRegistry.find((r) => r.id === d.conceptId)
          if (c) resolved.push({ id: c.id, name: c.name, description: c.description, score: d.score, isNew: false })
          continue
        }

        const cheapDupe = byNormalizedName.get(normalizeConceptName(d.name))
        if (cheapDupe) {
          resolved.push({ id: cheapDupe.id, name: cheapDupe.name, description: cheapDupe.description, score: d.score, isNew: false })
          continue
        }

        // Backstop against a near-duplicate the batch prompt's own
        // cross-segment consistency instruction still let through.
        const dupeId = await findDuplicateConcept(d.name, d.description ?? '', activeRegistry, model)
        const semanticDupe = dupeId ? activeRegistry.find((r) => r.id === dupeId) : undefined
        if (semanticDupe) {
          resolved.push({ id: semanticDupe.id, name: semanticDupe.name, description: semanticDupe.description, score: d.score, isNew: false })
          continue
        }

        const { data: created, error: createErr } = await admin
          .from('concepts')
          .insert({ conversation_id: body.conversationId, name: d.name, description: d.description ?? '' })
          .select('id, name, description')
          .single()
        if (created) {
          resolved.push({ id: created.id, name: created.name, description: created.description, score: d.score, isNew: true })
          activeRegistry.push(created)
          byNormalizedName.set(normalizeConceptName(created.name), created)
        } else if (createErr?.code === '23505') {
          const { data: rows } = await admin
            .from('concepts')
            .select('id, name, description')
            .eq('conversation_id', body.conversationId)
          const existing = (rows ?? []).find((r) => normalizeConceptName(r.name) === normalizeConceptName(d.name))
          if (existing) {
            resolved.push({ id: existing.id, name: existing.name, description: existing.description, score: d.score, isNew: false })
            activeRegistry.push(existing)
            byNormalizedName.set(normalizeConceptName(existing.name), existing)
          }
        }
      }

      const top3 = resolved
        .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
      out.set(seg.id, top3)
    }

    const reusedIds = [...out.values()].flat().filter((r) => !r.isNew).map((r) => r.id)
    if (reusedIds.length) {
      await Promise.all([...new Set(reusedIds)].map((id) => admin.rpc('increment_concept_usage', { concept_id: id })))
    }

    for (const seg of toTag) {
      const top3 = out.get(seg.id) ?? []
      await admin.from('segment_concepts').delete().eq('segment_head_node_id', seg.id)
      if (top3.length) {
        await admin.from('segment_concepts').insert(
          top3.map((r) => ({ segment_head_node_id: seg.id, concept_id: r.id, score: r.score })),
        )
      }
      await admin
        .from('segment_concept_state')
        .upsert({ segment_head_node_id: seg.id, content_hash: seg.hash, tagged_at: new Date().toISOString() })
    }

    return out
  })

  for (const [id, list] of batchResults) {
    results.set(id, list.map((r) => ({ id: r.id, name: r.name, description: r.description })))
  }

  return { segments: Object.fromEntries(results) }
})
