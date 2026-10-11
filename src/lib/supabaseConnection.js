const NOT_CONFIGURED = {
  connected: false,
  code: 'not_configured',
  message: 'Supabase belum dikonfigurasi. Periksa .env.local lalu restart Vite.',
}

const CONNECTION_OK = {
  connected: true,
  code: 'ok',
  message: 'API Supabase terjangkau dan tabel cloud merespons. Login tetap diperlukan untuk mengakses project.',
}

function isNetworkFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  return error?.name === 'TypeError'
    || /failed to fetch|networkerror|network request failed|fetch failed|enotfound|eai_again|could not resolve|name not resolved|dns/i.test(message)
}

function toConnectionFailure(error) {
  if (isNetworkFailure(error)) {
    return {
      connected: false,
      code: 'network_error',
      message: 'Tidak dapat menghubungi Supabase. Periksa Project URL, DNS, dan koneksi jaringan.',
    }
  }

  return {
    connected: false,
    code: error?.code || 'request_failed',
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : 'Tidak dapat menghubungi database Supabase.',
  }
}

/**
 * Read-only connectivity check. Accepting a client argument keeps the behavior
 * independently testable without needing live credentials or network access.
 */
export async function checkSupabaseConnectionWithClient(client) {
  if (!client) return { ...NOT_CONFIGURED }

  try {
    const { error } = await client
      .from('cineblock_projects')
      .select('id')
      .limit(1)

    if (error) return toConnectionFailure(error)
    return { ...CONNECTION_OK }
  } catch (error) {
    return toConnectionFailure(error)
  }
}
