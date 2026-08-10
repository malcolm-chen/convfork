// Concept tagging: shared logic for server/api/concepts/assign.post.ts.
// Two separate prompts/parsers — one for tagging a single segment (the
// common case: one node just got shared while the canvas is open), one for
// tagging many segments in a single call (backfill / "Retag topics"). The
// batch prompt's "resolve consistently across segments" framing is
// deliberately kept out of the single-segment prompt: it's irrelevant noise
// there and risks diluting focus on the one conversation that actually
// matters.
//
// The batch case matters for concept consistency: tagging N segments
// independently means the model resolves reuse/create decisions for each
// with no visibility into what it just decided for the others, which is how
// near-duplicate concepts (e.g. "User Persona Development" vs "Target
// Persona") kept slipping through even with a registry and a dedicated
// dedup check. Giving the model every segment at once in the batch prompt
// lets it converge on a shared vocabulary within a single decision pass.

import type { SnapshotMessage } from './mergedContext'

export interface ConceptCandidate {
  id: string
  name: string
  description: string
}

export interface ConceptDecision {
  action: 'reuse' | 'create'
  conceptId?: string
  name: string
  description?: string
  score: number
}

export interface SegmentInput {
  id: string
  transcript: string
}

// Same cyrb53-style hash as composables/useNodeSummaries.ts (reimplemented
// here — that one's client-only and this needs to run server-side), used to
// skip re-tagging a segment whose shared content hasn't actually changed.
export function hashTranscript(shared: SnapshotMessage[]): string {
  const str = shared.map((m) => `${m.id}:${m.content}`).join('\n')
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)
}

// Lowercase, whitespace-collapsed form used for the cheap duplicate backstop
// before creating a new concept, and to match the DB's lower(name) index.
export function normalizeConceptName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Shared by both prompts — what makes a concept good, independent of
// whether one or many conversations are being tagged right now.
const CONCEPT_GUIDELINES = `When identifying or creating a concept, abstract from specific details to the underlying theme those details instantiate.

A good concept should satisfy all of the following:

Generalizable: It captures a theme that could meaningfully apply to other conversations in this workspace, rather than summarizing a detail unique to this one.
Coherent: Everything assigned to the concept should share one clear underlying meaning. The concept should have a single recognizable semantic focus.
Distinct: The concept should represent a meaningfully different theme from other concepts already in the registry. If an existing concept captures essentially the same underlying theme, reuse it rather than introducing a more specific or differently worded variant.
Informative: The concept should be broad without becoming generic or meaningless. Abstract only as far as the common meaning remains useful for distinguishing what something is about.
Reusable as a category: Imagine encountering a future conversation. The concept should be defined clearly enough that you could consistently decide whether that conversation belongs to it.

When choosing the abstraction level, ask: "What broader theme is this specific discussion an instance of?" Continue abstracting until the concept could plausibly cover multiple related discussions, but stop before further abstraction would erase an important semantic distinction.

Good Examples:
"OAuth Token Refresh Bug" → "Authentication"
"Bar Chart Color Palette" → "Data Visualization"
"Welcome Modal Copy Wording" → "Onboarding"
"Users Can Disable Personalized Notifications" → "User Control"

Do NOT abstract so far that the concept loses useful meaning. Bad examples:
"Authentication" → "Technology" ✗
"Data Visualization" → "Design" ✗
"Onboarding" → "User Experience" ✗`

export function buildSingleConceptPrompt(existing: ConceptCandidate[], transcript: string): string {
  const registry = existing.length
    ? existing.map((c) => `- ${c.id}: "${c.name}" — ${c.description}`).join('\n')
    : '(none yet — this is the first tagged conversation in this project)'

  return `You maintain a shared **high-level concept vocabulary** for a collaborative LLM workspace.

A concept is a **broad, reusable theme or category** that could plausibly apply to many different conversations in this project over time. Think of concepts as **section headings in a project index**, not a summary or caption for this specific conversation.

For the conversation below:

1. Identify the high-level themes that meaningfully characterize it.
2. For each theme, check whether an existing concept is a reasonable semantic match.
3. **Prioritize reusing an existing concept if it covers the theme.**
4. Create a new concept only when the conversation introduces a genuinely distinct high-level theme not reasonably covered by any existing concept.

### Concept guidelines

${CONCEPT_GUIDELINES}

### Selection

Rank applicable concepts by:

1. **Salience** — how central the concept is to the conversation;
2. **Coverage** — how much of the conversation it captures;
3. **Non-redundancy** — whether it represents a distinct theme not already captured by another selected concept.

Most conversations are genuinely about only **1 or 2** themes — that should be the normal result. Only include a 3rd concept when the conversation clearly spans a third theme that is just as central as the first two. A single well-chosen concept beats three unfocused ones. **Never pad the list to reach 3.**

Score honestly, not generously: score below 0.5 for anything that's only a minor or tangential part of the conversation. Only include a concept at all if you would score it 0.5 or higher.

### Output format

Respond with JSON only. Do not include commentary or code fences. Use exactly this structure:

{"concepts":[
{"action":"reuse","concept_id":"<id from the registry below>","score":0.0},
{"action":"create","name":"<1-3 word broad reusable category>","description":"<one sentence defining its reusable scope>","score":0.0}
]}

If fewer than 3 concepts are genuinely salient, return fewer — an empty array is fine.

EXISTING CONCEPTS:
${registry}

CONVERSATION:
${transcript}
`
}

export function buildBatchConceptPrompt(existing: ConceptCandidate[], segments: SegmentInput[]): string {
  const registry = existing.length
    ? existing.map((c) => `- ${c.id}: "${c.name}" — ${c.description}`).join('\n')
    : '(none yet — this is the first tagged conversation in this project)'

  const conversations = segments.map((s) => `[SEGMENT ${s.id}]\n${s.transcript}`).join('\n\n---\n\n')

  return `You maintain a shared **high-level concept vocabulary** for a collaborative LLM workspace.

A concept is a **broad, reusable theme or category** that could plausibly apply to many different conversations in this project over time. Think of concepts as **section headings in a project index**, not summaries or captions for a specific conversation.

You are tagging MULTIPLE conversation segments in this one request (listed at the bottom, each under its own \`[SEGMENT <id>]\` marker). Treat each segment independently for what it's about, but resolve concepts **consistently across all of them**: if two segments below are about the same underlying theme, they must end up with the SAME concept — never invent two near-duplicate concepts for the same theme just because they appear in different segments here.

For each segment:

1. Identify the high-level themes that meaningfully characterize it.
2. For each theme, check whether an existing concept (from the registry below, OR one you're already using for another segment in this batch) is a reasonable semantic match.
3. **Prioritize reusing an existing or already-used-in-this-batch concept if it covers the theme.**
4. Create a new concept only when the segment introduces a genuinely distinct high-level theme not reasonably covered by anything existing or already proposed in this batch.

### Concept guidelines

${CONCEPT_GUIDELINES}

### Selection (per segment)

Rank applicable concepts by:

1. **Salience** — how central the concept is to that segment;
2. **Coverage** — how much of the segment it captures;
3. **Non-redundancy** — whether it represents a distinct theme not already captured by another concept selected for the SAME segment.

Most segments are genuinely about only **1 or 2** themes — that should be the normal result. Only include a 3rd concept when a segment clearly spans a third theme that is just as central as the first two, not merely present somewhere in it. A single well-chosen concept beats three unfocused ones. **Never pad a segment's list to reach 3.**

Score honestly, not generously: score below 0.5 for anything that's only a minor or tangential part of that segment. Only include a concept at all if you would score it 0.5 or higher.

### Output format

Respond with JSON only. Do not include commentary or code fences.

Use exactly this structure — **you MUST include one entry for every single segment id listed below, with no exceptions**, even if its concepts array ends up empty:

{"segments": {
"<segment id>": {"concepts": [
{"action":"reuse","concept_id":"...","score":0.0},
{"action":"create","name":"<1-3 word broad reusable category>","description":"...","score":0.0}
]},
"<another segment id>": {"concepts": []}
}}

Keep descriptions to one short sentence each — you're tagging several segments in this one response, so budget your output across all of them rather than writing long descriptions for the first few and running out of room for the rest.

For \`"reuse"\`:

* \`concept_id\` must match an ID from the existing concept registry, OR a \`concept_id\` you are reusing consistently across segments in this batch.
* Do not rename the existing concept.

For \`"create"\`:

* \`name\` must follow the concept guidelines above.
* \`description\` should briefly define the concept's reusable scope, rather than summarize any one segment.
* If the SAME new concept applies to multiple segments in this batch, use the exact same \`name\` for all of them — they'll be merged into one concept.

Scores must be between \`0.0\` and \`1.0\`.

EXISTING CONCEPTS:
${registry}

SEGMENTS TO TAG:
${conversations}
`
}

// A dedicated, narrow follow-up check before a "create" decision actually
// becomes a new row — a backstop against a near-duplicate slipping past
// either prompt's own consistency instructions. Returns the existing
// concept's id to reuse instead, or null if it's genuinely distinct.
export async function findDuplicateConcept(
  candidateName: string,
  candidateDescription: string,
  existing: ConceptCandidate[],
  model?: string,
): Promise<string | null> {
  if (!existing.length) return null
  const list = existing.map((c) => `- ${c.id}: "${c.name}" — ${c.description}`).join('\n')
  const prompt = `A collaborative workspace maintains a shared vocabulary of broad, reusable conversation-topic concepts.

A new concept has just been proposed:
"${candidateName}" — ${candidateDescription}

Existing concepts already in the vocabulary:
${list}

Does the new concept represent essentially the SAME underlying theme as one of the existing concepts above — even if worded differently, more specific, or phrased from a different angle? Two concepts are the same theme if someone tagging future conversations would struggle to consistently pick one over the other, or would reasonably tag the same conversation with both.

Respond with JSON only, no commentary, no code fences: {"same_as": "<existing concept id, or null if genuinely distinct>"}`

  const raw = await completeLLM([{ role: 'user', content: prompt }], { model, maxTokens: 200 })
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    const id = typeof parsed?.same_as === 'string' ? parsed.same_as : null
    return id && existing.some((c) => c.id === id) ? id : null
  } catch {
    return null
  }
}

function parseDecisionItems(items: any[]): ConceptDecision[] {
  const byKey = new Map<string, ConceptDecision>()
  for (const item of items) {
    const score = Number.isFinite(item?.score) ? Math.min(1, Math.max(0, item.score)) : 0.5

    if (item?.action === 'reuse') {
      const conceptId = typeof item.concept_id === 'string' ? item.concept_id : ''
      if (!conceptId) continue
      const key = `reuse:${conceptId}`
      const prev = byKey.get(key)
      if (!prev || score > prev.score) byKey.set(key, { action: 'reuse', conceptId, name: '', score })
      continue
    }

    if (item?.action === 'create') {
      const name = typeof item.name === 'string' ? item.name.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
      if (!name) continue
      const description =
        typeof item.description === 'string' ? item.description.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      const key = `create:${name.toLowerCase()}`
      const prev = byKey.get(key)
      if (!prev || score > prev.score) byKey.set(key, { action: 'create', name, description, score })
    }
  }

  // Backstop independent of the prompt's own "score honestly" instruction —
  // a weak/tangential concept should be dropped rather than padding the
  // list out to 3 just because 3 slots are available.
  const MIN_SCORE = 0.5
  return [...byKey.values()]
    .filter((d) => d.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

// Defensive parse: a malformed/unparseable response degrades to "no
// concepts" rather than ever throwing — a bad LLM reply shouldn't break the
// canvas.
export function parseSingleConceptResponse(raw: string): ConceptDecision[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return []
  let parsed: any
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  const items = Array.isArray(parsed?.concepts) ? parsed.concepts : []
  return parseDecisionItems(items)
}

// Same defensive philosophy, scoped per segment: a parse failure or a
// segment id the model dropped from its response both degrade to "no
// concepts for that segment" rather than throwing or losing the whole batch.
export function parseBatchConceptResponse(raw: string, segmentIds: string[]): Map<string, ConceptDecision[]> {
  const result = new Map<string, ConceptDecision[]>()
  for (const id of segmentIds) result.set(id, [])

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    console.error('[concepts] batch response had no parseable JSON object (likely truncated — raw, first 800 chars):', raw.slice(0, 800))
    return result
  }

  let parsed: any
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (err) {
    console.error(
      '[concepts] batch response JSON.parse failed:',
      (err as Error).message,
      '\nraw (first 800 chars):',
      raw.slice(0, 800),
    )
    return result
  }
  const segmentsObj = parsed?.segments
  if (!segmentsObj || typeof segmentsObj !== 'object') {
    console.error('[concepts] batch response missing a "segments" object (raw, first 800 chars):', raw.slice(0, 800))
    return result
  }

  const missing = segmentIds.filter((id) => !(id in segmentsObj))
  if (missing.length) {
    console.error(`[concepts] batch response omitted ${missing.length}/${segmentIds.length} segment id(s):`, missing)
  }

  for (const id of segmentIds) {
    const items = Array.isArray(segmentsObj[id]?.concepts) ? segmentsObj[id].concepts : []
    result.set(id, parseDecisionItems(items))
  }
  return result
}
