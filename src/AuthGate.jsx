import { cloneElement, useEffect, useState } from 'react'
import { Cloud, LockKeyhole, LogIn, Monitor, ShieldCheck, FolderOpen } from 'lucide-react'
import { supabaseClient, supabaseConfig } from './lib/supabaseClient.js'
import { loadCloudWorkspace } from './lib/cineblockSync.js'

function friendlyAuthError(error, flow = 'login') {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (code === 'otp_expired' || code === 'access_denied' || /expired|invalid.*token|token.*invalid/i.test(message)) {
    return 'Tautan undangan sudah kedaluwarsa atau tidak berlaku. Minta pemilik CineBlock mengirim undangan baru.'
  }
  if (code === 'AUTH_SESSION_MISSING') return 'Sesi undangan tidak ditemukan. Buka tautan undangan terbaru lagi.'
  if (flow === 'login' && /invalid login credentials/i.test(message)) {
    return 'Email atau kata sandi tidak cocok. Gunakan kata sandi akun CineBlock, bukan kata sandi email.'
  }
  if (code === 'email_not_confirmed') return 'Email akun belum dikonfirmasi. Periksa email undangan atau hubungi pemilik CineBlock.'
  if (flow === 'invite') return 'Kata sandi belum berhasil disimpan. Tautan undangan mungkin kedaluwarsa; minta undangan baru jika masalah berlanjut.'
  return 'CineBlock belum dapat memverifikasi sesi. Periksa koneksi lalu coba lagi.'
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [busy, setBusy] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudProjects, setCloudProjects] = useState([])
  const [selectedCloudProjectId, setSelectedCloudProjectId] = useState('')
  const [cloudWorkspace, setCloudWorkspace] = useState(null)
  const [cloudProjectId, setCloudProjectId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [localMode, setLocalMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = supabaseClient.auth.onAuthStateChange(current => {
      if (cancelled) return
      setSession(current)
      setError('')
      setNotice('')
      if (!current) {
        setLocalMode(false)
        setCloudProjects([])
        setSelectedCloudProjectId('')
        setCloudWorkspace(null)
        setCloudProjectId('')
      }
    })
    supabaseClient.auth.getSession()
      .then(current => {
        if (!cancelled) setSession(current)
      })
      .catch(err => {
        if (!cancelled) setError(friendlyAuthError(err, 'callback'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.access_token || session.auth_flow === 'invite') return undefined
    let cancelled = false
    setCloudLoading(true)
    setCloudProjects([])
    setSelectedCloudProjectId('')
    setCloudWorkspace(null)
    setCloudProjectId('')
    supabaseClient.listProjects()
      .then(rows => {
        if (cancelled) return
        const projects = Array.isArray(rows) ? rows : []
        setCloudProjects(projects)
        setSelectedCloudProjectId(current => projects.some(project => project.id === current) ? current : (projects[0]?.id || ''))
      })
      .catch(err => {
        if (!cancelled) setError(friendlyAuthError(err, 'projects'))
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false)
      })
    return () => { cancelled = true }
  }, [session?.access_token, session?.auth_flow])

  const signIn = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await supabaseClient.auth.signInWithPassword({ email, password })
      setSession(result.session)
      setPassword('')
    } catch (err) {
      setError(friendlyAuthError(err, 'login'))
    } finally {
      setBusy(false)
    }
  }

  const completeInvitation = async event => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (newPassword.length < 8) {
      setError('Kata sandi harus minimal 8 karakter.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak sama.')
      return
    }
    setBusy(true)
    try {
      const next = await supabaseClient.auth.updatePassword({ password: newPassword })
      setSession(next)
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Kata sandi akun CineBlock berhasil dibuat. Memuat proyek cloud…')
    } catch (err) {
      setError(friendlyAuthError(err, 'invite'))
    } finally {
      setBusy(false)
    }
  }

  const openCloudProject = async projectId => {
    if (!projectId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const workspace = await loadCloudWorkspace(projectId)
      setCloudWorkspace(workspace)
      setCloudProjectId(projectId)
      setNotice('')
    } catch (err) {
      setError(err.message || 'Proyek cloud tidak dapat dimuat atau kamu tidak memiliki akses.')
    } finally {
      setBusy(false)
    }
  }

  const createCloudProject = async event => {
    event.preventDefault()
    const name = newProjectName.trim().slice(0, 160)
    if (!name || !session?.user?.id) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const project = await supabaseClient.createProject({ name, ownerId: session.user.id })
      if (!project?.id) throw new Error('Proyek cloud tidak dapat dibuat.')
      setCloudProjects(previous => [project, ...previous.filter(item => item.id !== project.id)])
      setSelectedCloudProjectId(project.id)
      setNewProjectName('')
      await openCloudProject(project.id)
    } catch (err) {
      setError(err.message || 'Proyek cloud tidak dapat dibuat.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <main className="auth-gate"><div className="auth-gate-card"><div className="auth-gate-brand"><Cloud size={22} /> CINEBLOCK</div><p role="status">Memeriksa sesi akun…</p></div></main>
  }

  if (session?.access_token && session.auth_flow !== 'invite' && cloudWorkspace && cloudProjectId) {
    return cloneElement(children, { initialWorkspace: cloudWorkspace, cloudProjectId })
  }
  if (localMode && !session) return children

  const isInvitation = session?.auth_flow === 'invite'
  const needsProjectSelection = Boolean(session?.access_token && !isInvitation)

  return (
    <main className="auth-gate">
      <section className="auth-gate-card" aria-labelledby="auth-gate-title">
        <div className="auth-gate-brand"><Cloud size={24} strokeWidth={1.8} /><span>CINEBLOCK</span></div>
        <div className="auth-gate-icon">{isInvitation ? <ShieldCheck size={25} /> : needsProjectSelection ? <FolderOpen size={25} /> : <LockKeyhole size={25} />}</div>
        <h1 id="auth-gate-title">{isInvitation ? 'Aktifkan akun CineBlock' : needsProjectSelection ? 'Pilih proyek cloud' : 'Masuk ke CineBlock'}</h1>
        <p className="auth-gate-subtitle">{isInvitation ? 'Undangan terverifikasi. Buat kata sandi khusus untuk akun CineBlock.' : needsProjectSelection ? 'Pilih proyek yang diberikan kepadamu. Workspace lokal tidak akan dibuka sebagai pengganti proyek cloud.' : 'Workspace cloud hanya tersedia setelah kamu masuk dengan akun yang diizinkan.'}</p>

        {!supabaseConfig.configured ? (
          <p className="auth-gate-error" role="alert">Layanan cloud belum dikonfigurasi. Hubungi pengelola CineBlock.</p>
        ) : isInvitation ? (
          <form className="auth-gate-form" onSubmit={completeInvitation}>
            <label>Email undangan</label>
            <input type="email" value={session.user?.email || ''} readOnly aria-readonly="true" />
            <label htmlFor="cineblock-gate-new-password">Kata sandi baru</label>
            <input id="cineblock-gate-new-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Minimal 8 karakter" />
            <label htmlFor="cineblock-gate-confirm-password">Ulangi kata sandi</label>
            <input id="cineblock-gate-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Ketik ulang kata sandi" />
            <button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Buat kata sandi dan lanjutkan'}</button>
          </form>
        ) : needsProjectSelection ? (
          <div className="auth-gate-form">
            {cloudLoading ? <p role="status">Memuat daftar proyek yang diizinkan…</p> : cloudProjects.length > 0 ? (
              <>
                <label htmlFor="cineblock-cloud-project-choice">Proyek cloud</label>
                <select id="cineblock-cloud-project-choice" value={selectedCloudProjectId} onChange={event => setSelectedCloudProjectId(event.target.value)}>
                  {cloudProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <button type="button" onClick={() => openCloudProject(selectedCloudProjectId)} disabled={busy || !selectedCloudProjectId}><FolderOpen size={16} /> {busy ? 'Memuat proyek…' : 'Buka proyek cloud'}</button>
              </>
            ) : (
              <>
                <p className="auth-gate-empty">Akun ini belum memiliki proyek cloud yang dapat diakses.</p>
                <form className="auth-gate-form" onSubmit={createCloudProject}>
                  <label htmlFor="cineblock-new-cloud-project">Nama proyek baru</label>
                  <input id="cineblock-new-cloud-project" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} maxLength={160} required placeholder="Nama proyek CineBlock" />
                  <button type="submit" disabled={busy}>{busy ? 'Membuat…' : 'Buat proyek cloud'}</button>
                </form>
              </>
            )}
          </div>
        ) : (
          <form className="auth-gate-form" onSubmit={signIn}>
            <label htmlFor="cineblock-gate-email">Email akun CineBlock</label>
            <input id="cineblock-gate-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nama@email.com" />
            <label htmlFor="cineblock-gate-password">Kata sandi CineBlock</label>
            <input id="cineblock-gate-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Kata sandi akun CineBlock" />
            <button type="submit" disabled={busy}><LogIn size={16} /> {busy ? 'Memverifikasi…' : 'Masuk'}</button>
          </form>
        )}

        {error && <p className="auth-gate-error" role="alert">{error}</p>}
        {notice && <p className="auth-gate-notice" role="status">{notice}</p>}
        {!needsProjectSelection && !isInvitation && <div className="auth-gate-footer"><LockKeyhole size={14} /><span>Akses proyek ditentukan oleh izin akun, bukan sekadar tautan aplikasi.</span></div>}
        {!needsProjectSelection && !isInvitation && <button type="button" className="auth-gate-local" onClick={() => { setError(''); setLocalMode(true) }}><Monitor size={15} /> Buka mode lokal di perangkat ini</button>}
        {localMode && <p className="auth-gate-local-note">Mode lokal hanya memakai data yang tersimpan di browser ini; mode ini bukan sesi cloud.</p>}
      </section>
    </main>
  )
}
