import { cloneElement, useEffect, useState } from 'react'
import { Cloud, LockKeyhole, LogIn, Monitor, ShieldCheck, FolderOpen, Users } from 'lucide-react'
import { supabaseClient, supabaseConfig } from './lib/supabaseClient.js'
import { loadCloudWorkspace } from './lib/cineblockSync.js'

function friendlyAuthError(error, flow = 'login') {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (code === 'otp_expired' || code === 'access_denied' || /expired|invalid.*token|token.*invalid/i.test(message)) {
    return flow === 'recovery'
      ? 'Tautan pengaturan kata sandi sudah kedaluwarsa atau tidak berlaku. Minta tautan baru dari halaman masuk.'
      : 'Tautan undangan sudah kedaluwarsa atau tidak berlaku. Minta pemilik CineBlock mengirim undangan baru.'
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
  const [showRecovery, setShowRecovery] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [confirmSignupPassword, setConfirmSignupPassword] = useState('')
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
  const [guestName, setGuestName] = useState('')

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
    if (!session?.access_token || ['invite', 'recovery'].includes(session.auth_flow)) return undefined
    let cancelled = false
    setCloudLoading(true)
    setCloudProjects([])
    setSelectedCloudProjectId('')
    setCloudWorkspace(null)
    setCloudProjectId('')
    supabaseClient.listProjects()
      .then(async rows => {
        if (cancelled) return
        const projects = Array.isArray(rows) ? rows : []
        setCloudProjects(projects)

        // Redeem share links only after authentication, then open the linked cloud
        // workspace directly instead of leaving the recipient on the local workspace.
        const shareToken = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('share')
          : null
        if (shareToken) {
          const redeemed = await supabaseClient.manageProjectAccess({ action: 'redeem_link', token: shareToken })
          if (cancelled) return
          if (!redeemed?.project_id) throw new Error('Tautan berbagi tidak memberikan proyek yang valid.')
          const workspace = await loadCloudWorkspace(redeemed.project_id)
          if (cancelled) return
          setCloudProjects(current => current.some(project => project.id === redeemed.project_id)
            ? current
            : [...current, { id: redeemed.project_id, name: 'Proyek dibagikan', owner_id: null }])
          setSelectedCloudProjectId(redeemed.project_id)
          setCloudWorkspace(workspace)
          setCloudProjectId(redeemed.project_id)
          window.history.replaceState({}, '', window.location.pathname + window.location.hash)
          setNotice('Proyek dari tautan berbagi berhasil dibuka.')
          return
        }

        // The verified CineBlock operator goes straight into their own project.
        // Other accounts keep the explicit project picker and only see shared projects.
        const isOperator = session.user?.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c'
        const defaultProject = isOperator
          ? projects.find(project => project.owner_id === session.user.id)
          : null
        const selectedProject = defaultProject || projects[0] || null
        setSelectedCloudProjectId(selectedProject?.id || '')
        // Owner's local workspace is the entry point. Do not force an empty cloud
        // project to replace it; the owner can explicitly import/share from the workspace UI.
      })
      .catch(err => {
        if (!cancelled) setError(friendlyAuthError(err, 'projects'))
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false)
      })
    return () => { cancelled = true }
  }, [session?.access_token, session?.auth_flow])

  const continueAsGuest = async event => {
    event.preventDefault()
    const name = guestName.trim().replace(/\\s+/g, ' ').slice(0, 80)
    if (name.length < 2) {
      setError('Masukkan nama minimal 2 karakter.')
      return
    }
    const shareToken = new URLSearchParams(window.location.search).get('share')
    if (!shareToken) {
      setError('Buka tautan proyek CineBlock yang dibagikan untuk bergabung.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await supabaseClient.auth.signInAnonymously({ displayName: name })
      const sessionWithName = result.session
      if (!sessionWithName?.access_token) throw new Error('Sesi tamu tidak berhasil dibuat.')
      setSession(sessionWithName)
      setNotice('Nama tersimpan. Memverifikasi tautan proyek…')
    } catch (err) {
      setError(err.message || 'Tidak dapat masuk sebagai tamu. Pastikan fitur Anonymous Sign-Ins diaktifkan.')
    } finally {
      setBusy(false)
    }
  }

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

  const signUp = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (password.length < 8) {
      setError('Kata sandi harus minimal 8 karakter.')
      setBusy(false)
      return
    }
    if (password !== confirmSignupPassword) {
      setError('Konfirmasi kata sandi tidak sama.')
      setBusy(false)
      return
    }
    try {
      const result = await supabaseClient.auth.signUpWithPassword({ email, password, redirectTo: window.location.origin })
      setPassword('')
      setConfirmSignupPassword('')
      if (result.session?.access_token) {
        setSession(result.session)
        setNotice('Akun berhasil dibuat. Kamu sudah masuk ke CineBlock.')
      } else {
        setAuthMode('login')
        setNotice('Pendaftaran berhasil. Periksa email untuk memverifikasi akun sebelum masuk.')
      }
    } catch (err) {
      setError(friendlyAuthError(err, 'signup'))
    } finally {
      setBusy(false)
    }
  }

  const requestPasswordRecovery = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await supabaseClient.auth.requestPasswordRecovery({ email, redirectTo: window.location.origin })
      setNotice('Jika email terdaftar, tautan untuk mengatur kata sandi akan dikirim. Periksa inbox dan folder spam.')
      setShowRecovery(false)
    } catch (err) {
      setError(err.message || 'Email pemulihan belum dapat dikirim. Coba lagi nanti.')
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
      const project = await supabaseClient.createProject({ name })
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

  const currentShareToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('share')
    : null

  // The app remains directly accessible for local work. A shared project link
  // asks for a display name, then uses a scoped anonymous Supabase identity.
  if (!loading && !session?.access_token && !currentShareToken) {
    return cloneElement(children, {})
  }

  if (loading) {
    return <main className="auth-gate"><div className="auth-gate-card"><div className="auth-gate-brand"><Cloud size={22} /> CINEBLOCK</div><p role="status">Memeriksa sesi akun…</p></div></main>
  }

  if (currentShareToken && (!session?.access_token || session.user?.is_anonymous) && !cloudWorkspace) {
    return (
      <main className="auth-gate">
        <section className="auth-gate-card" aria-labelledby="cineblock-guest-title">
          <div className="auth-gate-brand"><Cloud size={24} strokeWidth={1.8} /><span>CINEBLOCK</span></div>
          <div className="auth-gate-icon"><Users size={25} /></div>
          <h1 id="cineblock-guest-title">{session?.access_token ? 'Membuka proyek…' : 'Gabung ke proyek'}</h1>
          <p className="auth-gate-subtitle">{session?.access_token ? 'Memverifikasi tautan dan memuat workspace bersama.' : 'Masukkan nama agar perubahanmu dapat dikenali di proyek ini. Tidak perlu email atau kata sandi.'}</p>
          {!session?.access_token && (
            <form className="auth-gate-form" onSubmit={continueAsGuest}>
              <label htmlFor="cineblock-guest-name">Nama kamu</label>
              <input id="cineblock-guest-name" autoComplete="name" maxLength={80} required minLength={2} value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="Contoh: Betz" />
              <button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk ke proyek'}</button>
            </form>
          )}
          {error && <p className="auth-gate-error" role="alert">{error}</p>}
          {notice && <p className="auth-gate-notice" role="status">{notice}</p>}
        </section>
      </main>
    )
  }

  if (session?.access_token && session.user?.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c' && !['invite', 'recovery'].includes(session.auth_flow) && !cloudWorkspace) {
    return cloneElement(children, {})
  }
  if (session?.access_token && !['invite', 'recovery'].includes(session.auth_flow) && cloudWorkspace && cloudProjectId) {
    return cloneElement(children, { initialWorkspace: cloudWorkspace, cloudProjectId })
  }
  if (localMode && !session) return <div className="local-mode-shell"><div className="local-mode-banner">Mode lokal aktif — data hanya tersimpan di perangkat ini, bukan di cloud.<button type="button" onClick={() => setLocalMode(false)}>Kembali ke login</button></div>{children}</div>

  const isInvitation = session?.auth_flow === 'invite'
  const isRecovery = session?.auth_flow === 'recovery'
  const isPasswordSetup = isInvitation || isRecovery
  const needsProjectSelection = Boolean(session?.access_token && !isPasswordSetup)
  const isLoginMode = authMode === 'login'

  return (
    <main className="auth-gate">
      <section className="auth-gate-card" aria-labelledby="auth-gate-title">
        <div className="auth-gate-brand"><Cloud size={24} strokeWidth={1.8} /><span>CINEBLOCK</span></div>
        <div className="auth-gate-icon">{isInvitation ? <ShieldCheck size={25} /> : needsProjectSelection ? <FolderOpen size={25} /> : <LockKeyhole size={25} />}</div>
        <h1 id="auth-gate-title">{isPasswordSetup ? (isRecovery ? 'Atur kata sandi CineBlock' : 'Aktifkan akun CineBlock') : needsProjectSelection ? 'Pilih proyek cloud' : showRecovery ? 'Atur ulang kata sandi' : isLoginMode ? 'Masuk ke CineBlock' : 'Buat akun CineBlock'}</h1>
        <p className="auth-gate-subtitle">{isPasswordSetup ? (isRecovery ? 'Buat kata sandi baru untuk akun CineBlock kamu.' : 'Undangan terverifikasi. Buat kata sandi khusus untuk akun CineBlock.') : needsProjectSelection ? 'Pilih proyek yang diberikan kepadamu. Workspace lokal tidak akan dibuka sebagai pengganti proyek cloud.' : showRecovery ? 'Masukkan email akunmu. Kami akan mengirim tautan untuk membuat kata sandi baru.' : isLoginMode ? 'Masuk dengan akun CineBlock yang sudah kamu miliki.' : 'Buat akun dengan email dan kata sandi. Akses ke proyek orang lain tetap memerlukan undangan pemilik proyek.'}</p>

        {!supabaseConfig.configured ? (
          <p className="auth-gate-error" role="alert">Layanan cloud belum dikonfigurasi. Hubungi pengelola CineBlock.</p>
        ) : isPasswordSetup ? (
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
                {session?.user?.id === 'cf4a51e8-825e-4db4-8b8a-037d3908663c' ? (
                  <>
                    <p className="auth-gate-empty">Akun pemilik CineBlock belum memiliki proyek cloud. Buat proyek pertama untuk mulai bekerja.</p>
                    <form className="auth-gate-form" onSubmit={createCloudProject}>
                      <label htmlFor="cineblock-new-cloud-project">Nama proyek baru</label>
                      <input id="cineblock-new-cloud-project" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} maxLength={160} required placeholder="Nama proyek CineBlock" />
                      <button type="submit" disabled={busy}>{busy ? 'Membuat…' : 'Buat proyek cloud'}</button>
                    </form>
                  </>
                ) : (
                  <p className="auth-gate-empty">Akun ini belum memiliki proyek cloud yang dibagikan kepadamu. Hubungi pemilik CineBlock untuk meminta akses. Hanya pemilik CineBlock yang dapat membuat dan membagikan proyek.</p>
                )}
              </>
            )}
          </div>
        ) : showRecovery ? (
          <form className="auth-gate-form" onSubmit={requestPasswordRecovery}>
            <label htmlFor="cineblock-recovery-email">Email akun CineBlock</label>
            <input id="cineblock-recovery-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nama@email.com" />
            <button type="submit" disabled={busy}>{busy ? 'Mengirim tautan…' : 'Kirim tautan pengaturan kata sandi'}</button>
            <button type="button" className="auth-gate-secondary-action" onClick={() => { setShowRecovery(false); setError(''); setNotice('') }}>Kembali ke masuk</button>
          </form>
        ) : (
          <>
            <div className="auth-mode-switch" role="tablist" aria-label="Jenis akses akun">
              <button type="button" role="tab" aria-selected={isLoginMode} className={isLoginMode ? 'active' : ''} onClick={() => { setAuthMode('login'); setShowRecovery(false); setError(''); setNotice('') }}>Log in</button>
              <button type="button" role="tab" aria-selected={!isLoginMode} className={!isLoginMode ? 'active' : ''} onClick={() => { setAuthMode('signup'); setShowRecovery(false); setError(''); setNotice('') }}>Sign up</button>
            </div>
            {showRecovery ? (
              <form className="auth-gate-form" onSubmit={requestPasswordRecovery}>
                <label htmlFor="cineblock-recovery-email">Email akun CineBlock</label>
                <input id="cineblock-recovery-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nama@email.com" />
                <button type="submit" disabled={busy}>{busy ? 'Mengirim tautan…' : 'Kirim tautan pengaturan kata sandi'}</button>
                <button type="button" className="auth-gate-secondary-action" onClick={() => { setShowRecovery(false); setError(''); setNotice('') }}>Kembali ke masuk</button>
              </form>
            ) : (
              <form className="auth-gate-form" onSubmit={isLoginMode ? signIn : signUp}>
                <label htmlFor="cineblock-gate-email">Email</label>
                <input id="cineblock-gate-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nama@email.com" />
                <label htmlFor="cineblock-gate-password">Kata sandi</label>
                <input id="cineblock-gate-password" type="password" autoComplete={isLoginMode ? 'current-password' : 'new-password'} minLength={isLoginMode ? undefined : 8} required value={password} onChange={event => setPassword(event.target.value)} placeholder={isLoginMode ? 'Kata sandi akun CineBlock' : 'Minimal 8 karakter'} />
                {!isLoginMode && <>
                  <label htmlFor="cineblock-gate-confirm-signup-password">Ulangi kata sandi</label>
                  <input id="cineblock-gate-confirm-signup-password" type="password" autoComplete="new-password" minLength={8} required value={confirmSignupPassword} onChange={event => setConfirmSignupPassword(event.target.value)} placeholder="Ketik ulang kata sandi" />
                </>}
                <button type="submit" disabled={busy}>{busy ? (isLoginMode ? 'Memverifikasi…' : 'Membuat akun…') : isLoginMode ? <><LogIn size={16} /> Log in</> : 'Sign up'}</button>
              </form>
            )}
          </>
        )}

        {error && <p className="auth-gate-error" role="alert">{error}</p>}
        {notice && <p className="auth-gate-notice" role="status">{notice}</p>}
        {!needsProjectSelection && !isPasswordSetup && !showRecovery && isLoginMode && <button type="button" className="auth-gate-secondary-action" onClick={() => { setShowRecovery(true); setError(''); setNotice('') }}>Lupa kata sandi?</button>}
        {!needsProjectSelection && !isPasswordSetup && <div className="auth-gate-footer"><LockKeyhole size={14} /><span>Akses proyek ditentukan oleh izin akun, bukan sekadar tautan aplikasi.</span></div>}
        {!needsProjectSelection && !isPasswordSetup && !showRecovery && <button type="button" className="auth-gate-local" onClick={() => { setError(''); setLocalMode(true) }}><Monitor size={15} /> Buka mode lokal di perangkat ini</button>}
        {localMode && <p className="auth-gate-local-note">Mode lokal hanya memakai data yang tersimpan di browser ini; mode ini bukan sesi cloud.</p>}
      </section>
    </main>
  )
}
