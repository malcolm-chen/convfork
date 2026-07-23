// Admit or reject a join request. Authorization rule: the caller must already be
// a member of the team the request targets ("team members can admit them").
// Approving sets the requester's users.team_id — a cross-user write that only the
// secret-key client may perform, which is exactly why this lives server-side.

interface Body { requestId?: string; action?: 'approve' | 'reject' }

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { requestId, action } = await readBody<Body>(event)
  if (!requestId || (action !== 'approve' && action !== 'reject')) {
    throw createError({ statusCode: 400, statusMessage: 'requestId and action (approve|reject) required' })
  }

  const admin = useSupabaseAdmin()

  const { data: req } = await admin
    .from('team_join_requests')
    .select('id, team_id, user_id, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) throw createError({ statusCode: 404, statusMessage: 'Request not found' })
  if (req.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: `Request already ${req.status}` })
  }

  // Caller must be a member of the target team.
  const { data: me } = await admin.from('users').select('team_id').eq('id', user.id).single()
  if (me?.team_id !== req.team_id) {
    throw createError({ statusCode: 403, statusMessage: 'Only team members can decide join requests' })
  }

  if (action === 'approve') {
    const { error: joinErr } = await admin
      .from('users')
      .update({ team_id: req.team_id })
      .eq('id', req.user_id)
    if (joinErr) throw createError({ statusCode: 500, statusMessage: joinErr.message })
  }

  const { error } = await admin
    .from('team_join_requests')
    .update({ status: action === 'approve' ? 'approved' : 'rejected', decided_at: new Date().toISOString(), decided_by: user.id })
    .eq('id', requestId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { ok: true }
})
