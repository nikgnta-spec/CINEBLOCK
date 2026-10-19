import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const DISPLAY_NAME_KEY = 'cineblock.display-name'
const CLOUD_MAP_KEY = 'cineblock.cloud-project-map'
let client

export function isCloudSyncConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY)
}

export function getCloudClient() {
  if (!isCloudSyncConfigured()) throw new Error('Sinkronisasi cloud belum dikonfigurasi untuk aplikasi ini.')
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  }
  return client
}

export function getSavedDisplayName() {
  try { return window.localStorage.getItem(DISPLAY_NAME_KEY) || '' } catch { return '' }
}

export function readCloudProjectMap() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CLOUD_MAP_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function writeCloudProjectMap(map) {
  try { window.localStorage.setItem(CLOUD_MAP_KEY, JSON.stringify(map)) } catch { /* memory session remains usable */ }
}

export async function ensureCloudSession(displayName = '') {
  const supabase = getCloudClient()
  let { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!sessionData.session) {
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) throw error
    sessionData = { session: data.session }
  }
  const user = sessionData.session?.user
  const savedName = getSavedDisplayName()
  let name = String(displayName || savedName || user?.user_metadata?.display_name || '').trim().slice(0, 80)
  if (!name && typeof window !== 'undefined') {
    name = String(window.prompt('Masukkan nama tampilan untuk kolaborasi CineBlock:') || '').trim().slice(0, 80)
  }
  if (!name) throw new Error('Nama tampilan diperlukan untuk mengaktifkan sinkronisasi.')
  try { window.localStorage.setItem(DISPLAY_NAME_KEY, name) } catch { /* also persisted in auth metadata */ }
  if (user?.user_metadata?.display_name !== name) {
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } })
    if (error) throw error
  }
  const { data: refreshed, error: refreshError } = await supabase.auth.getSession()
  if (refreshError) throw refreshError
  if (!refreshed.session) throw new Error('Sesi sinkronisasi tidak tersedia.')
  return { supabase, session: refreshed.session, displayName: name }
}

export async function redeemCloudLink(token) {
  const supabase = getCloudClient()
  const { data, error } = await supabase.functions.invoke('cineblock-project-access', { body: { action: 'redeem_link', token } })
  if (error) throw new Error(data?.error || error.message || 'Tautan berbagi gagal dibuka.')
  if (!data?.project_id || !data?.role) throw new Error(data?.error || 'Respons tautan berbagi tidak valid.')
  return { id: data.project_id, role: data.role }
}

export async function fetchCloudProject(projectId) {
  const { data, error } = await getCloudClient().from('cineblock_projects')
    .select('id,owner_id,name,payload,revision,updated_at').eq('id', projectId).single()
  if (error) throw error
  return data
}

export async function createCloudProject(name, payload) {
  const { data, error } = await getCloudClient().functions.invoke('cineblock-project-access', {
    body: { action: 'create_project', name, payload },
  })
  if (error) {
    let serverMessage = data?.error
    try {
      const response = error.context
      if (!serverMessage && response && typeof response.clone === 'function') {
        const body = await response.clone().json()
        serverMessage = body?.error || body?.message
      }
    } catch { /* preserve the Supabase client error as a fallback */ }
    throw new Error(serverMessage || error.message || 'Proyek cloud gagal dibuat.')
  }
  if (!data?.project?.id) throw new Error(data?.error || 'Server tidak mengembalikan proyek cloud.')
  return data.project
}

export async function saveCloudProject(projectId, payload, expectedRevision) {
  const name = String(payload?.name || payload?.project?.title || 'Proyek tanpa judul').trim().slice(0, 200) || 'Proyek tanpa judul'
  const { data, error } = await getCloudClient().from('cineblock_projects')
    .update({ name, payload, revision: expectedRevision + 1, updated_at: new Date().toISOString() })
    .eq('id', projectId).eq('revision', expectedRevision)
    .select('id,owner_id,name,payload,revision,updated_at').maybeSingle()
  if (error) throw error
  if (data) return { ok: true, project: data }
  return { ok: false, conflict: true, project: await fetchCloudProject(projectId) }
}

export async function createCloudShareLink(projectId, role = 'editor') {
  const { data, error } = await getCloudClient().functions.invoke('cineblock-project-access', {
    body: { action: 'create_link', project_id: projectId, role },
  })
  if (error) throw new Error(data?.error || error.message || 'Tautan berbagi gagal dibuat.')
  if (!data?.url) throw new Error(data?.error || 'Server tidak mengembalikan tautan berbagi.')
  return data
}

export function subscribeToCloudProject(projectId, onUpdate, onStatus) {
  const channel = getCloudClient().channel('cineblock-project-' + projectId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cineblock_projects', filter: 'id=eq.' + projectId }, event => onUpdate(event.new))
    .subscribe(status => onStatus?.(status))
  return () => { getCloudClient().removeChannel(channel) }
}

export function isEmptyCloudPayload(payload) {
  return !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0
}
