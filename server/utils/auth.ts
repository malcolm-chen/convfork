import type { H3Event } from 'h3'
import { serverSupabaseUser } from '#supabase/server'

// Resolve the logged-in user from the Supabase auth cookie/JWT on the request.
// Cookie-based, so it works for navigator.sendBeacon (which can't set headers).
export async function requireUser(event: H3Event) {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return user
}
