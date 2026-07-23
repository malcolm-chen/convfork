// Thin convenience wrapper over @nuxtjs/supabase's auto-imported helpers, so
// component code has one import surface. The anon-key client is RLS-bound.
export function useDb() {
  return useSupabaseClient()
}

export function useCurrentUser() {
  return useSupabaseUser()
}
