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

async function getFreshSession() {
  const session = readSession()
  if (!session?.access_token) return null
  const expiresAt = Number(session.expires_at || 0)
  if (!expiresAt || expiresAt * 1000 > Date.now() + 60_000) return session
  if (!session.refresh_token) {
    writeSession(null)
    return null
  }
  try {
    const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
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
