function normalizeProjectUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

/**
 * Validate frontend-safe Supabase settings separately from Vite's environment
 * so URL validation can be tested without a browser or live project.
 */
export function parseSupabaseConfig(urlValue, keyValue) {
  const urlString = normalizeProjectUrl(urlValue)
  const publishableKey = typeof keyValue === 'string' ? keyValue.trim() : ''

  if (!urlString || !publishableKey) return null

  try {
    const url = new URL(urlString)
    const isLocalhost = url.hostname === 'localhost'
    if (url.protocol !== 'https:' && !isLocalhost) return null
    if (!isLocalhost && !url.hostname.endsWith('.supabase.co')) return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null

    return { url: url.origin, publishableKey }
  } catch {
    return null
  }
}

export function getSupabaseConfig() {
  return parseSupabaseConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  )
}

export function getSupabaseSetupStatus() {
  return getSupabaseConfig()
    ? { configured: true, message: 'Konfigurasi Supabase tersedia.' }
    : {
        configured: false,
        message: 'Supabase belum dikonfigurasi atau Project URL tidak valid. Periksa VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di .env.local.',
      }
}
