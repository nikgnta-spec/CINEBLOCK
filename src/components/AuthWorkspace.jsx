import { useEffect, useState } from 'react'
import { LogIn, LogOut, Cloud, RefreshCw } from 'lucide-react'
import { supabaseClient, supabaseConfig } from '../lib/supabaseClient.js'

export default function AuthWorkspace() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadProjects = async () => {
    const rows = await supabaseClient.listProjects()
    setProjects(Array.isArray(rows) ? rows : [])
    setSelectedProjectId(current => rows.some(project => project.id === current) ? current : '')
  }

  useEffect(() => {
    let cancelled = false
    supabaseClient.auth.getSession()
      .then(current => {
        if (!cancelled) setSession(current)
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Sesi cloud tidak dapat diperiksa.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const unsubscribe = supabaseClient.auth.onAuthStateChange(current => {
      setSession(current)
      if (!current) {
        setProjects([])
        setSelectedProjectId('')
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.access_token) return
    let cancelled = false
    setBusy(true)
    supabaseClient.listProjects()
      .then(rows => {
        if (!cancelled) {
          setProjects(Array.isArray(rows) ? rows : [])
          setSelectedProjectId(current => rows.some(project => project.id === current) ? current : '')
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Daftar proyek cloud tidak dapat dimuat.')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => { cancelled = true }
  }, [session?.access_token])

  const signIn = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await supabaseClient.auth.signInWithPassword({ email, password })
      setSession(result.session)
      setPassword('')
      setNotice('Login berhasil. Pilih proyek cloud sebelum integrasi sinkronisasi diaktifkan.')
    } catch (err) {
      setError(err.message || 'Login gagal. Periksa email dan kata sandi.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      await supabaseClient.auth.signOut()
      setSession(null)
      setProjects([])
      setSelectedProjectId('')
      setNotice('Kamu sudah keluar dari akun cloud. Data lokal tetap tersimpan.')
    } catch (err) {
      setError(err.message || 'Tidak dapat keluar dari akun cloud.')
    } finally {
      setBusy(false)
    }
  }

  const createProject = async event => {
    event.preventDefault()
    if (!session?.user?.id || !newProjectName.trim()) return
    setBusy(true)
    setError('')
    try {
      const project = await supabaseClient.createProject({ name: newProjectName.trim().slice(0, 160), ownerId: session.user.id })
      if (!project) throw new Error('Supabase tidak mengembalikan proyek yang dibuat.')
      setProjects(previous => [project, ...previous.filter(item => item.id !== project.id)])
      setSelectedProjectId(project.id)
      setNewProjectName('')
      setNotice('Proyek cloud dibuat. Data lokal belum diunggah atau digabungkan.')
    } catch (err) {
      setError(err.message || 'Proyek cloud tidak dapat dibuat.')
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfig.configured) {
    return <div className="cloud-workspace cloud-workspace-unconfigured" title="Atur environment variable Vite untuk mengaktifkan login cloud"><Cloud size={14} /><span>Cloud belum dikonfigurasi</span></div>
  }

  return (
    <section className="cloud-workspace" aria-label="Akun dan proyek cloud">
      {loading ? <span className="cloud-muted">Memeriksa sesi…</span> : !session ? (
        <form className="cloud-login-form" onSubmit={signIn}>
          <label className="sr-only" htmlFor="cineblock-cloud-email">Email akun CineBlock</label>
          <input id="cineblock-cloud-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="Email cloud" />
          <label className="sr-only" htmlFor="cineblock-cloud-password">Kata sandi akun CineBlock</label>
          <input id="cineblock-cloud-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Kata sandi" />
          <button className="btn btn-secondary" type="submit" disabled={busy}><LogIn size={14} /> Masuk</button>
        </form>
      ) : (
        <div className="cloud-session">
          <span className="cloud-user" title={session.user?.email || 'Akun terhubung'}><Cloud size={14} /> {session.user?.email || 'Terhubung'}</span>
          <label className="sr-only" htmlFor="cineblock-cloud-project">Pilih proyek cloud</label>
          <select id="cineblock-cloud-project" className="cloud-project-select" value={selectedProjectId} onChange={event => { setSelectedProjectId(event.target.value); setNotice('Proyek cloud dipilih. Sinkronisasi tetap terkunci sampai pemetaan data dan OCC terverifikasi.') }} disabled={busy || projects.length === 0}>
            <option value="">Pilih proyek cloud…</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button className="btn btn-secondary cloud-icon-button" type="button" onClick={() => loadProjects().catch(err => setError(err.message))} disabled={busy} title="Muat ulang proyek cloud" aria-label="Muat ulang proyek cloud"><RefreshCw size={14} /></button>
          <button className="btn btn-secondary cloud-icon-button" type="button" onClick={signOut} disabled={busy} title="Keluar" aria-label="Keluar"><LogOut size={14} /></button>
        </div>
      )}
      {session && projects.length === 0 && !busy && (
        <form className="cloud-create-form" onSubmit={createProject}>
          <input aria-label="Nama proyek cloud baru" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} maxLength={160} placeholder="Nama proyek cloud baru" required />
          <button className="btn btn-secondary" type="submit" disabled={busy}>Buat</button>
        </form>
      )}
      {error && <p className="cloud-feedback is-error" role="alert">{error}</p>}
      {notice && <p className="cloud-feedback" role="status">{notice}</p>}
    </section>
  )
}
