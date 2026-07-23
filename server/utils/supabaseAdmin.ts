import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// service_role client — SERVER ONLY. Bypasses RLS for system-level writes
// (assistant nodes, team_interaction_logs, log-table reads). Never import this
// from a .vue file or composable.
let _admin: SupabaseClient | null = null

export function useSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const config = useRuntimeConfig()
  const url = process.env.SUPABASE_URL
  if (!url || !config.supabaseSecretKey) {
    throw createError({ statusCode: 500, statusMessage: 'Supabase secret-key config missing' })
  }
  _admin = createClient(url, config.supabaseSecretKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}
