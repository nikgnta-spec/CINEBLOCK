import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './supabaseConfig'
import { checkSupabaseConnectionWithClient } from './supabaseConnection'

const config = getSupabaseConfig()

// A missing local environment file should not prevent CineBlock's local-first
// experience from loading. Cloud features must check for null before use.
export const supabase = config
  ? createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null

export function isSupabaseConfigured() {
  return supabase !== null
}

/**
 * Checks public API reachability and table grants without reading project data.
 * RLS may correctly return an empty list for a signed-out user.
 */
export function checkSupabaseConnection() {
  return checkSupabaseConnectionWithClient(supabase)
}
