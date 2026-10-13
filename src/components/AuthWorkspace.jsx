import { useEffect, useState } from 'react'
import { LogIn, LogOut, Cloud, RefreshCw } from 'lucide-react'
import { supabaseClient, supabaseConfig } from '../lib/supabaseClient.js'
import { importLocalWorkspaceToCloud } from '../lib/cineblockImport.js'
import { syncLocalScenesAndShots } from '../lib/cineblockSync.js'

export default function AuthWorkspace({ localWorkspace }) {
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
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)

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


  const importLocal = async () => {
    if (!selectedProjectId) return
    if (!window.confirm('Salin data proyek lokal yang sedang aktif ke proyek cloud terpilih? Proyek cloud harus kosong. Data lokal tidak akan dihapus.')) return
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const counts = await importLocalWorkspaceToCloud(selectedProjectId, localWorkspace)
      const elements = ['floorplan', 'cameras', 'actors', 'lighting', 'props'].reduce((sum, key) => sum + Number(counts[key] || 0), 0)
      setNotice('Impor awal berhasil: ' + (counts.scenes || 0) + ' scene, ' + (counts.shots || 0) + ' shot, ' + elements + ' elemen denah. Data lokal tetap menjadi sumber kerja aktif.' + (counts.baselineWarning ? ' Sinkronisasi OCC belum siap: ' + counts.baselineWarning : ''))
    } catch (err) {
      setError(err.message || 'Impor awal ke cloud gagal. Data lokal tetap utuh.')
    } finally {
      setImporting(false)
    }
  }


  const syncScenesAndShots = async () => {
    if (!selectedProjectId) return
    setSyncing(true)
    setError('')
    setNotice('')
    try {
      const result = await syncLocalScenesAndShots(selectedProjectId, localWorkspace)
      const summary = 'Sinkronisasi Scene/Shot selesai: ' + result.updated + ' diperbarui, ' + result.inserted + ' ditambahkan, ' + result.unchanged + ' tidak berubah.'
      if (result.conflicts.length) setError(summary + ' Konflik: ' + result.conflicts.slice(0, 4).join(' '))
      else setNotice(summary + ' Sinkronisasi memakai OCC per baris; konflik cloud dilaporkan tanpa menimpa perubahan.')
    } catch (err) {
      setError(err.message || 'Sinkronisasi gagal. Data lokal tetap tersimpan.')
    } finally {
      setSyncing(false)
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
          <select id="cineblock-cloud-project" className="cloud-project-select" value={selectedProjectId} onChange={event => { setSelectedProjectId(event.target.value); setNotice('Proyek cloud dipilih sebagai target. Impor awal hanya berlaku untuk proyek kosong; sinkronisasi Scene/Shot memakai OCC.') }} disabled={busy || projects.length === 0}>
            <option value="">Pilih proyek cloud…</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button className="btn btn-secondary cloud-icon-button" type="button" onClick={() => loadProjects().catch(err => setError(err.message))} disabled={busy || importing} title="Muat ulang proyek cloud" aria-label="Muat ulang proyek cloud"><RefreshCw size={14} /></button>
          <button className="btn btn-secondary cloud-icon-button" type="button" onClick={signOut} disabled={busy || importing} title="Keluar" aria-label="Keluar"><LogOut size={14} /></button>
        </div>
      )}


      {session && projects.length > 0 && selectedProjectId && (
        <button className="btn btn-secondary" type="button" onClick={syncScenesAndShots} disabled={busy || importing || syncing} title="Sinkronkan Scene, Shot, dan elemen Floorplan dengan OCC">
          {syncing ? <RefreshCw size={13} /> : <Cloud size={13} />}{syncing ? ' Menyinkronkan…' : ' Sinkronkan Scene, Shot & Floorplan'}
        </button>
      )}
      {session && projects.length > 0 && selectedProjectId && (
        <button className="btn btn-secondary" type="button" onClick={importLocal} disabled={busy || importing} title="Impor awal sekali ke proyek cloud yang masih kosong">
          {importing ? <RefreshCw size={13} /> : <Cloud size={13} />}{importing ? ' Menyalin…' : ' Salin lokal ke cloud'}
        </button>
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
