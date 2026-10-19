import { Cloud, Copy, Link2, RefreshCw, Wifi, WifiOff, X } from 'lucide-react'

const STATUS_LABELS = {
  local: 'Lokal saja',
  connecting: 'Menghubungkan…',
  synced: 'Tersinkron',
  syncing: 'Menyinkronkan…',
  offline: 'Offline — perubahan tersimpan lokal',
  conflict: 'Konflik perubahan',
  error: 'Sinkronisasi bermasalah',
}

export default function CloudSyncDialog({
  open,
  onClose,
  configured,
  projectName,
  displayName,
  onDisplayNameChange,
  cloudStatus,
  cloudRole,
  cloudProjectId,
  cloudError,
  shareUrl,
  isOnline,
  onConnect,
  onCreateShareLink,
  onCopyShareLink,
  shareLinkToOpen,
  onShareLinkToOpenChange,
  onOpenExistingCloudLink,
  onRetrySync,
  onLoadRemote,
  onOverwriteRemote,
  conflictRemote,
}) {
  if (!open) return null
  const busy = cloudStatus === 'connecting' || cloudStatus === 'syncing'
  const statusLabel = STATUS_LABELS[cloudStatus] || STATUS_LABELS.local

  return (
    <div className="cloud-sync-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="cloud-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-sync-title">
        <header className="cloud-sync-header">
          <div className="cloud-sync-heading-icon"><Cloud size={21} /></div>
          <div className="cloud-sync-heading-copy">
            <h2 id="cloud-sync-title">Sinkronisasi CineBlock</h2>
            <p>{projectName || 'Proyek tanpa judul'}</p>
          </div>
          <button className="btn btn-secondary cloud-sync-close" type="button" onClick={onClose} disabled={busy} aria-label="Tutup"><X size={16} /></button>
        </header>

        {!configured ? (
          <div className="cloud-sync-notice is-error">
            Sinkronisasi belum dikonfigurasi pada deployment ini. Proyek tetap tersimpan lokal; variabel Supabase perlu disiapkan sebelum fitur cloud dapat digunakan.
          </div>
        ) : (
          <>
            <div className={'cloud-sync-status is-' + cloudStatus}>
              {isOnline ? <Wifi size={17} /> : <WifiOff size={17} />}
              <div>
                <strong>{statusLabel}</strong>
                <span>{cloudProjectId ? 'Proyek ini terhubung ke penyimpanan cloud.' : 'Proyek ini hanya tersimpan di perangkat saat ini.'}</span>
              </div>
            </div>

            <label className="cloud-sync-field">
              <span>Nama tampilan</span>
              <input value={displayName} onChange={event => onDisplayNameChange(event.target.value)} maxLength={80} placeholder="Contoh: Betz — DoP" />
              <small>Nama ini disimpan di sesi kolaborasi; tidak perlu email atau password.</small>
            </label>

            {cloudError && <div className="cloud-sync-notice is-error" role="alert">{cloudError}</div>}

            {cloudProjectId ? (
              <div className="cloud-sync-connected">
                <div className="cloud-sync-meta">
                  <span>Akses perangkat ini</span>
                  <strong>{cloudRole === 'owner' ? 'Pemilik' : cloudRole === 'viewer' ? 'Viewer' : 'Editor'}</strong>
                </div>
                {cloudRole === 'owner' && (
                  <div className="cloud-sync-share">
                    <button className="btn btn-secondary" type="button" onClick={onCreateShareLink} disabled={busy}>
                      <Link2 size={15} /> Buat tautan editor
                    </button>
                    {shareUrl && (
                      <div className="cloud-sync-link-row">
                        <input aria-label="Tautan berbagi proyek" readOnly value={shareUrl} onFocus={event => event.target.select()} />
                        <button className="btn btn-secondary" type="button" onClick={onCopyShareLink} title="Salin tautan"><Copy size={15} /></button>
                      </div>
                    )}
                    <small>Kirim tautan ini ke HP untuk membuka proyek yang sama. Siapa pun yang memiliki tautan editor dapat mengubah proyek.</small>
                  </div>
                )}
                {(cloudStatus === 'offline' || cloudStatus === 'error') && cloudRole !== 'viewer' && (
                  <button className="btn btn-secondary" type="button" onClick={onRetrySync} disabled={busy}>
                    <RefreshCw size={14} /> Coba sinkronkan ulang
                  </button>
                )}
                {cloudRole !== 'owner' && <p className="cloud-sync-helper">Perangkat ini tersambung melalui tautan berbagi. Minta pemilik membuat tautan baru jika akses perlu dibagikan ke perangkat lain.</p>}
              </div>
            ) : (
              <div className="cloud-sync-connect">
                <p>Hubungkan proyek lokal ini agar perubahan dapat dibuka di perangkat lain. Proyek cloud hanya dapat dibuat oleh pemilik yang sudah diaktifkan.</p>
                <button className="btn btn-primary" type="button" onClick={onConnect} disabled={busy || !displayName.trim()}>
                  <Cloud size={15} /> {busy ? 'Menghubungkan…' : 'Sinkronkan proyek ini'}
                </button>

                <div className="cloud-sync-existing-link">
                  <label className="cloud-sync-field">
                    <span>Sudah punya tautan editor?</span>
                    <input
                      value={shareLinkToOpen}
                      onChange={event => onShareLinkToOpenChange(event.target.value)}
                      placeholder="Tempel tautan editor proyek cloud"
                      aria-label="Tautan editor proyek cloud yang sudah ada"
                    />
                    <small>Buka proyek cloud yang sudah ada di domain ini tanpa membuat proyek duplikat atau aktivasi pemilik ulang.</small>
                  </label>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={onOpenExistingCloudLink}
                    disabled={busy || !shareLinkToOpen.trim()}
                  >
                    <Link2 size={15} /> Buka proyek cloud yang sudah ada
                  </button>
                </div>
              </div>
            )}

            {conflictRemote && (
              <div className="cloud-sync-conflict">
                <strong>Perubahan berbeda terdeteksi</strong>
                <p>Versi cloud berubah ketika perangkat ini juga memiliki edit yang belum tersinkron. Pilih versi yang akan dipertahankan.</p>
                <div className="cloud-sync-conflict-actions">
                  <button className="btn btn-secondary" type="button" onClick={onLoadRemote}>Muat versi cloud</button>
                  <button className="btn btn-primary" type="button" onClick={onOverwriteRemote}>Timpa dengan versi perangkat ini</button>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="cloud-sync-footer">
          <span><RefreshCw size={13} /> Data lokal tetap disimpan sebagai cache.</span>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>Tutup</button>
        </footer>
      </section>
    </div>
  )
}
