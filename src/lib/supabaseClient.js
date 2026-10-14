const ENV = import.meta.env || {}
const SUPABASE_URL = String(ENV.VITE_SUPABASE_URL || 'https://pycxqqghkpkoqqgatprv.supabase.co').replace(/\/+$/, '')
const SUPABASE_KEY = ENV.VITE_SUPABASE_PUBLISHABLE_KEY || ENV.VITE_SUPABASE_ANON_KEY || 'sb_publishable_GRixB_y1fBvVfa777zhjXw_O7LCmSS_'
const SESSION_KEY = 'cineblock.supabase.session.v1'
const AUTH_EVENT = 'cineblock:supabase-auth'

// The fallback is a Supabase publishable key, intended for browser exposure. Never put a service_role key here.
export const supabaseConfig = Object.freeze({
  configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
  url: SUPABASE_URL,
})

export class SupabaseRequestError extends Error {
  constructor(message, status = 0, code = '') {
    super(message)
    this.name = 'SupabaseRequestError'
    this.status = status
    this.code = code
  }
}

export class OptimisticConflictError extends Error {
  constructor(table, id, expectedVersion) {
    super('Data ini sudah diubah pengguna lain. Muat ulang data terbaru sebelum mencoba lagi.')
    this.name = 'OptimisticConflictError'
    this.code = 'CINEBLOCK_OCC_CONFLICT'
    this.table = table
    this.id = id
    this.expectedVersion = expectedVersion
  }
}

export function requireVersionedUpdate(table, id, expectedVersion, rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new OptimisticConflictError(table, id, expectedVersion)
  }
  return rows[0]
}

/**
 * Reads Supabase's implicit-flow auth callback from either the query string or URL fragment.
 * Returns null for ordinary URLs. Never logs or returns the raw URL.
 */
export function parseAuthCallbackUrl(input) {
  const url = new URL(input)
  const query = new URLSearchParams(url.search)
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  const params = new URLSearchParams([...query.entries(), ...fragment.entries()])
  const accessToken = params.get('access_token')
  const type = params.get('type')
  const hasAuthError = params.has('error') || params.has('error_description')
  const isAuthCallback = Boolean(accessToken || hasAuthError || ['invite', 'signup', 'recovery', 'magiclink', 'email'].includes(type))
  if (!isAuthCallback) return null

  return {
    access_token: accessToken || '',
    refresh_token: params.get('refresh_token') || '',
    token_type: params.get('token_type') || 'bearer',
    expires_in: Number(params.get('expires_in') || 3600),
    type: type || '',
    error: params.get('error') || '',
    error_description: params.get('error_description') || '',
    cleanUrl: url.origin + url.pathname,
  }
}

function readSession() {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeSession(session) {
  try {
    if (session) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session))
    else globalThis.localStorage?.removeItem(SESSION_KEY)
  } catch {
    // Auth remains usable for this tab, but may not survive a reload when storage is blocked.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: session }))
}

async function decodeResponse(response) {
  const text = await response.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { message: text } }
  }
  if (!response.ok) {
    throw new SupabaseRequestError(
      data?.msg || data?.message || data?.error_description || data?.error || `Supabase request failed (${response.status})`,
      response.status,
      data?.code || data?.error_code || '',
    )
  }
  return data
}

async function authRequest(path, body, token) {
  if (!supabaseConfig.configured) throw new SupabaseRequestError('Cloud belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY.', 0, 'CONFIG_MISSING')
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })
  return decodeResponse(response)
}

let callbackPromise
async function consumeAuthCallback() {
  if (typeof window === 'undefined' || !window.location || !window.history) return null
  if (callbackPromise) return callbackPromise
  callbackPromise = (async () => {
    const callback = parseAuthCallbackUrl(window.location.href)
    if (!callback) return null

    // Remove credentials from browser history immediately, even if token validation later fails.
    window.history.replaceState(window.history.state, '', callback.cleanUrl)

    if (callback.error) {
      throw new SupabaseRequestError(callback.error_description || 'Undangan tidak dapat diverifikasi.', 400, callback.error)
    }
    if (!callback.access_token) {
      throw new SupabaseRequestError('Tautan autentikasi tidak memuat token sesi. Minta undangan baru.', 400, 'AUTH_CALLBACK_TOKEN_MISSING')
    }
    if (callback.type && !['invite', 'signup', 'magiclink', 'email'].includes(callback.type)) {
      throw new SupabaseRequestError('Jenis tautan autentikasi tidak didukung untuk login.', 400, 'AUTH_CALLBACK_TYPE_UNSUPPORTED')
    }

    const session = {
      access_token: callback.access_token,
      refresh_token: callback.refresh_token,
      token_type: callback.token_type,
      expires_in: callback.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + callback.expires_in,
      auth_flow: callback.type === 'invite' || callback.type === 'recovery' ? callback.type : '',
    }
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    })
    session.user = await decodeResponse(response)
    writeSession(session)
    return session
  })()
  try {
    return await callbackPromise
  } finally {
    callbackPromise = null
  }
}

async function getFreshSession() {
  const session = await consumeAuthCallback()
  if (session) return session
  const storedSession = readSession()
  if (!storedSession?.access_token) return null
  const expiresAt = Number(storedSession.expires_at || 0)
  if (!expiresAt || expiresAt * 1000 > Date.now() + 60_000) return storedSession
  if (!storedSession.refresh_token) {
    writeSession(null)
    return null
  }
  try {
    const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: storedSession.refresh_token })
    const next = { ...refreshed, expires_at: refreshed.expires_at || Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600) }
    writeSession(next)
    return next
  } catch {
    writeSession(null)
    return null
  }
}

async function request(path, { method = 'GET', body, prefer, token } = {}) {
  if (!supabaseConfig.configured) throw new SupabaseRequestError('Cloud belum dikonfigurasi.', 0, 'CONFIG_MISSING')
  const session = token ? null : await getFreshSession()
  const headers = { apikey: SUPABASE_KEY, Accept: 'application/json' }
  if (session?.access_token || token) headers.Authorization = `Bearer ${token || session.access_token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return decodeResponse(response)
}

export const supabaseClient = Object.freeze({
  auth: {
    async getSession() {
      return getFreshSession()
    },
    async signInWithPassword({ email, password }) {
      const session = await authRequest('token?grant_type=password', { email: email.trim(), password })
      const next = { ...session, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600) }
      writeSession(next)
      return { session: next, user: next.user }
    },
    async updatePassword({ password }) {
      if (typeof password !== 'string' || password.length < 8) {
        throw new SupabaseRequestError('Kata sandi harus minimal 8 karakter.', 400, 'PASSWORD_TOO_SHORT')
      }
      const session = await getFreshSession()
      if (!session?.access_token) throw new SupabaseRequestError('Sesi undangan tidak ditemukan. Buka tautan undangan terbaru lagi.', 401, 'AUTH_SESSION_MISSING')
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const user = await decodeResponse(response)
      const next = { ...session, user, auth_flow: '' }
      writeSession(next)
      return next
    },
    async signOut() {
      const session = await getFreshSession()
      if (session?.access_token) {
        try { await authRequest('logout', {}, session.access_token) } finally { writeSession(null) }
      } else {
        writeSession(null)
      }
    },
    async getUser() {
      const session = await getFreshSession()
      if (!session?.access_token) return null
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      })
      return decodeResponse(response)
    },
    onAuthStateChange(callback) {
      if (typeof window === 'undefined') return () => {}
      const handle = event => callback(event.detail ?? readSession())
      window.addEventListener(AUTH_EVENT, handle)
      window.addEventListener('storage', handle)
      return () => {
        window.removeEventListener(AUTH_EVENT, handle)
        window.removeEventListener('storage', handle)
      }
    },
  },
  async rpc(functionName, args) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(functionName)) throw new TypeError('Nama RPC tidak valid.')
    return request('rpc/' + functionName, { method: 'POST', body: args })
  },
  async listProjects() {
    return request('cineblock_projects?select=id,name,owner_id,updated_at&order=updated_at.desc')
  },
  async createProject({ name, ownerId }) {
    const rows = await request('cineblock_projects?select=id,name,owner_id,updated_at', {
      method: 'POST',
      body: { name: name.trim(), owner_id: ownerId, payload: {}, revision: 1 },
      prefer: 'return=representation',
    })
    return rows?.[0] || null
  },
  async listProjectMemberships(projectId) {
    return request(`cineblock_project_members?select=project_id,user_id,role&project_id=eq.${encodeURIComponent(projectId)}`)
  },
  async manageProjectAccess(payload) {
    const session = await getFreshSession()
    if (!session?.access_token) throw new SupabaseRequestError('Login diperlukan untuk mengelola akses proyek.', 401, 'AUTH_SESSION_MISSING')
    const response = await fetch(`${SUPABASE_URL}/functions/v1/cineblock-project-access`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    return decodeResponse(response)
  },
  async selectRows(table, filters = {}, select = '*') {
    assertTable(table)
    const params = new URLSearchParams({ select })
    for (const [key, value] of Object.entries(filters)) params.set(key, value)
    return request(`${table}?${params.toString()}`)
  },
  async insertRow(table, row) {
    assertTable(table)
    const rows = await request(table, { method: 'POST', body: row, prefer: 'return=representation' })
    return rows?.[0] || null
  },
  async updateProjectVersioned({ id, expectedRevision, changes }) {
    if (!id || !Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 1) throw new TypeError('id dan expectedRevision yang valid wajib diisi untuk OCC.')
    const params = new URLSearchParams({ id: 'eq.' + id, revision: 'eq.' + expectedRevision, select: 'id,revision,updated_at' })
    const rows = await request('cineblock_projects?' + params.toString(), { method: 'PATCH', body: changes, prefer: 'return=representation' })
    if (!Array.isArray(rows) || rows.length !== 1) throw new OptimisticConflictError('cineblock_projects', id, expectedRevision)
    return rows[0]
  },
  async deleteVersionedRow(table, { id, expectedVersion }) {
    assertTable(table)
    if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TypeError('id dan expectedVersion yang valid wajib diisi untuk OCC.')
    const params = new URLSearchParams({ id: 'eq.' + id, version: 'eq.' + expectedVersion, select: 'id,version' })
    const rows = await request(table + '?' + params.toString(), { method: 'DELETE', prefer: 'return=representation' })
    if (!Array.isArray(rows) || rows.length !== 1) throw new OptimisticConflictError(table, id, expectedVersion)
    return rows[0]
  },
  async updateVersionedRow(table, { id, expectedVersion, changes }) {
    assertTable(table)
    if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new TypeError('id dan expectedVersion yang valid wajib diisi untuk OCC.')
    }
    const params = new URLSearchParams({
      id: `eq.${id}`,
      version: `eq.${expectedVersion}`,
      select: 'id,version,updated_at,updated_by',
    })
    const rows = await request(`${table}?${params.toString()}`, {
      method: 'PATCH',
      body: changes,
      prefer: 'return=representation',
    })
    return requireVersionedUpdate(table, id, expectedVersion, rows)
  },
})

const ALLOWED_TABLES = new Set([
  'cineblock_projects',
  'cineblock_scenes',
  'cineblock_shots',
  'cineblock_floorplan_elements',
  'cineblock_cameras',
  'cineblock_actors',
  'cineblock_lighting',
  'cineblock_props',
  'cineblock_movements',
])

function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) throw new TypeError(`Tabel CineBlock tidak diizinkan: ${table}`)
}
