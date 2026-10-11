import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './supabaseConfig'

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
export async function checkSupabaseConnection() {
  if (!supabase) {
    return {
      connected: false,
      code: 'not_configured',
      message: 'Supabase belum dikonfigurasi. Periksa .env.local lalu restart Vite.',
    }
  }

  const { error } = await supabase
    .from('cineblock_projects')
    .select('id')
    .limit(1)

  if (error) {
    return {
      connected: false,
      code: error.code || 'request_failed',
      message: error.message || 'Tidak dapat menghubungi database Supabase.',
    }
  }

  return {
    connected: true,
    code: 'ok',
    message: 'API Supabase terjangkau dan tabel cloud merespons. Login tetap diperlukan untuk mengakses project.',
  }
}
