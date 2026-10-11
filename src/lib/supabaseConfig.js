const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()

export function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null

  try {
    const url = new URL(SUPABASE_URL)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null
    if (!url.hostname.endsWith('.supabase.co') && url.hostname !== 'localhost') return null
  } catch {
    return null
  }

  return {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  }
}

export function getSupabaseSetupStatus() {
  return getSupabaseConfig()
    ? { configured: true, message: 'Konfigurasi Supabase tersedia.' }
    : {
        configured: false,
        message: 'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di .env.local.',
      }
}
