import { useEffect, useState } from 'react'
import { LogIn, LogOut, Cloud, RefreshCw, Users, UserPlus, UserMinus, X } from 'lucide-react'
import { supabaseClient, supabaseConfig } from '../lib/supabaseClient.js'
import { importLocalWorkspaceToCloud } from '../lib/cineblockImport.js'
import { syncLocalScenesAndShots, loadCloudWorkspace } from '../lib/cineblockSync.js'

export default function AuthWorkspace({ initialProjectId = '', localWorkspace, onApplyCloudWorkspace, onBeforeLoadCloud }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId)
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loadingCloud, setLoadingCloud] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [members, setMembers] = useState([])

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


  const completeInvitation = async event => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (newPassword.length < 8) {
      setError('Kata sandi baru minimal 8 karakter.')
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
      setNotice('Undangan selesai. Kata sandi akun CineBlock berhasil dibuat; kamu sudah masuk ke akun cloud.')
    } catch (err) {
      setError(err.message || 'Kata sandi akun belum berhasil dibuat. Buka tautan undangan terbaru jika sesi sudah kedaluwarsa.')
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


  const loadCloud = async () => {
    if (!selectedProjectId) return
    if (!window.confirm('Ganti workspace lokal aktif dengan versi proyek cloud terpilih? Backup lokal akan diunduh lebih dulu.')) return
    setLoadingCloud(true)
    setError('')
    setNotice('')
    try {
      if (typeof onBeforeLoadCloud === 'function') onBeforeLoadCloud()
      const workspace = await loadCloudWorkspace(selectedProjectId)
      if (typeof onApplyCloudWorkspace === 'function') onApplyCloudWorkspace(workspace)
      setNotice('Workspace cloud dimuat ke perangkat. Backup lokal dibuat sebelum penggantian; baseline OCC disiapkan.')
    } catch (err) {
      setError(err.message || 'Workspace cloud tidak dapat dimuat. Data lokal tidak diganti.')
    } finally {
      setLoadingCloud(false)
    }
  }

  const manageAccess = async (action, extra = {}) => {
    if (!selectedProjectId) return
    setAccessBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await supabaseClient.manageProjectAccess({ action, project_id: selectedProjectId, ...extra })
      if (action === 'list') setMembers(Array.isArray(result.members) ? result.members : [])
      if (action === 'invite') {
        setInviteEmail('')
        setNotice(result.message || 'Akses proyek diperbarui.')
        const refreshed = await supabaseClient.manageProjectAccess({ action: 'list', project_id: selectedProjectId })
        setMembers(Array.isArray(refreshed.members) ? refreshed.members : [])
      }
      if (action === 'remove') {
        setNotice('Akses anggota berhasil dicabut.')
        const refreshed = await supabaseClient.manageProjectAccess({ action: 'list', project_id: selectedProjectId })
        setMembers(Array.isArray(refreshed.members) ? refreshed.members : [])
      }
    } catch (err) {
      setError(err.message || 'Pengelolaan akses proyek gagal.')
    } finally {
      setAccessBusy(false)
    }
  }

  const inviteMember = event => {
    event.preventDefault()
    if (!inviteEmail.trim()) return
    manageAccess('invite', { email: inviteEmail.trim(), role: inviteRole })
  }

  const removeMember = member => {
    if (!window.confirm('Cabut akses ' + (member.email || 'anggota ini') + ' dari proyek?')) return
    manageAccess('remove', { user_id: member.user_id })
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
      ) : session.auth_flow === 'invite' ? (
        <form className="cloud-login-form" onSubmit={completeInvitation} aria-label="Buat kata sandi akun CineBlock">
          <span className="cloud-user"><Cloud size={14} /> Undangan: {session.user?.email || 'akun cloud'}</span>
          <label className="sr-only" htmlFor="cineblock-new-password">Kata sandi baru</label>
          <input id="cineblock-new-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Buat kata sandi (min. 8 karakter)" />
          <label className="sr-only" htmlFor="cineblock-confirm-password">Konfirmasi kata sandi baru</label>
          <input id="cineblock-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Ulangi kata sandi" />
          <button className="btn btn-secondary" type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Buat kata sandi'}</button>
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
        <button className="btn btn-secondary" type="button" onClick={() => { const next = !accessOpen; setAccessOpen(next); if (next) manageAccess('list') }} disabled={accessBusy} title="Undang dan kelola akses anggota proyek">
          <Users size={13} /> {accessOpen ? 'Tutup kelola akses' : 'Kelola akses proyek'}
        </button>
      )}
      {accessOpen && session && selectedProjectId && (
        <div className="cloud-access-manager" aria-label="Kelola akses proyek">
          <div className="cloud-access-heading">
            <strong>Anggota proyek</strong>
            <button type="button" className="btn btn-secondary cloud-icon-button" onClick={() => setAccessOpen(false)} aria-label="Tutup kelola akses"><X size={14} /></button>
          </div>
          <p className="cloud-muted">Hanya owner yang dapat mengundang atau mencabut akses. Tautan undangan harus diterima melalui email.</p>
          <form className="cloud-invite-form" onSubmit={inviteMember}>
            <label htmlFor="cineblock-invite-email">Email orang yang diundang</label>
            <input id="cineblock-invite-email" type="email" required maxLength={254} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="nama@email.com" />
            <label htmlFor="cineblock-invite-role">Hak akses</label>
            <select id="cineblock-invite-role" value={inviteRole} onChange={event => setInviteRole(event.target.value)}>
              <option value="editor">Editor — dapat mengubah proyek</option>
              <option value="viewer">Viewer — hanya dapat melihat</option>
            </select>
            <button className="btn btn-secondary" type="submit" disabled={accessBusy || !inviteEmail.trim()}><UserPlus size={13} /> {accessBusy ? 'Memproses…' : 'Undang melalui email'}</button>
          </form>
          <div className="cloud-access-members">
            {members.map(member => (
              <div className="cloud-access-member" key={member.user_id}>
                <div><strong>{member.email}</strong><span>{member.role === 'owner' ? 'Owner' : member.role === 'editor' ? 'Editor' : 'Viewer'}</span></div>
                {member.role !== 'owner' && member.user_id !== session.user?.id && (
                  <button type="button" className="btn btn-secondary cloud-icon-button" onClick={() => removeMember(member)} disabled={accessBusy} title="Cabut akses anggota" aria-label={'Cabut akses ' + member.email}><UserMinus size={14} /></button>
                )}
              </div>
            ))}
            {!accessBusy && members.length === 0 && <p className="cloud-muted">Belum ada data anggota atau akses kelola anggota ditolak.</p>}
          </div>
        </div>
      )}
      {session && projects.length > 0 && selectedProjectId && (
        <button className="btn btn-secondary" type="button" onClick={loadCloud} disabled={busy || importing || syncing || loadingCloud} title="Unduh backup lokal lalu muat versi cloud">
          {loadingCloud ? <RefreshCw size={13} /> : <Cloud size={13} />}{loadingCloud ? ' Memuat cloud…' : ' Muat cloud ke lokal'}
        </button>
      )}
      {session && projects.length > 0 && selectedProjectId && (
        <button className="btn btn-secondary" type="button" onClick={syncScenesAndShots} disabled={busy || importing || syncing} title="Sinkronkan Info Proyek, Scene, Shot, Floorplan, dan Movement dengan OCC">
          {syncing ? <RefreshCw size={13} /> : <Cloud size={13} />}{syncing ? ' Menyinkronkan…' : ' Sinkronkan Proyek, Scene, Shot & Floorplan'}
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
