// Accepts one or more image/PDF files + a conversationId, uploads each to S3
// under uploads/{conversationId}/, and returns refs the client attaches to the
// next /api/chat call. No DB row yet — attachments are only persisted once
// they're actually sent with a message (see chat.post.ts).

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_PDF_BYTES = 25 * 1024 * 1024 // 25MB
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function kindOf(contentType: string): 'image' | 'pdf' | null {
  if (ALLOWED_IMAGE_TYPES.has(contentType)) return 'image'
  if (contentType === 'application/pdf') return 'pdf'
  return null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: 'no form data' })

  const conversationId = parts.find((p) => p.name === 'conversationId')?.data.toString('utf-8')
  if (!conversationId) throw createError({ statusCode: 400, statusMessage: 'conversationId required' })

  const admin = useSupabaseAdmin()
  const { data: convo } = await admin.from('conversations').select('id, team_id').eq('id', conversationId).single()
  if (!convo) throw createError({ statusCode: 404, statusMessage: 'conversation not found' })
  const { data: profile } = await admin.from('users').select('team_id').eq('id', user.id).single()
  if (!profile || profile.team_id !== convo.team_id) {
    throw createError({ statusCode: 403, statusMessage: 'not a member of this team' })
  }

  const files = parts.filter((p) => p.name === 'file' && p.filename)
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'no files provided' })

  const results = []
  for (const f of files) {
    const contentType = f.type || 'application/octet-stream'
    const kind = kindOf(contentType)
    if (!kind) {
      throw createError({ statusCode: 415, statusMessage: `unsupported file type: ${contentType} (${f.filename})` })
    }
    const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES
    if (f.data.length > maxBytes) {
      throw createError({
        statusCode: 413,
        statusMessage: `${f.filename} exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
      })
    }

    const safeName = (f.filename as string).replace(/[^\w.\- ]/g, '_')
    const key = `uploads/${conversationId}/${crypto.randomUUID()}-${safeName}`
    await putUpload(key, f.data, contentType)
    results.push({ key, filename: safeName, contentType, size: f.data.length, kind })
  }

  return { attachments: results }
})
