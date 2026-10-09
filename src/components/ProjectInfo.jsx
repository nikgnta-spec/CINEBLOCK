import { useId, useRef } from 'react'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'

function readAsDataUrl(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image file'))
    reader.readAsDataURL(fileOrBlob)
  })
}

async function makePersistentImage(file) {
  const originalDataUrl = await readAsDataUrl(file)

  // Keep vector and animated images intact.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return originalDataUrl
  }

  const image = await new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('Could not open the selected image'))
    element.src = originalDataUrl
  })

  const maxDimension = 1280
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))

  const context = canvas.getContext('2d')
  if (!context) return originalDataUrl

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const optimizedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.78))
  return optimizedBlob ? readAsDataUrl(optimizedBlob) : originalDataUrl
}

export default function ProjectInfo({ project, onChange }) {
  const set = (key, val) => onChange(p => ({ ...p, [key]: val }))
  const fileRefs = useRef([])

  const handleRefImg = async (idx, e) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return

    try {
      const dataUrl = await makePersistentImage(file)
      onChange(p => {
        const refs = [...p.visualRefs]
        refs[idx] = dataUrl
        return { ...p, visualRefs: refs }
      })
    } catch (error) {
      console.error('CINEBLOCK could not load visual reference:', error)
      window.alert('Gambar tidak dapat dibuka. Silakan pilih gambar lain.')
    } finally {
      input.value = ''
    }
  }

  const removeRef = (idx) => {
    onChange(p => {
      const refs = [...p.visualRefs]
      const labels = [...(p.visualRefLabels || Array(6).fill(''))]
      refs[idx] = null
      labels[idx] = ''
      return { ...p, visualRefs: refs, visualRefLabels: labels }
    })
  }

  const setRefLabel = (idx, value) => {
    onChange(p => {
      const labels = [...(p.visualRefLabels || Array(6).fill(''))]
      labels[idx] = value
      return { ...p, visualRefLabels: labels }
    })
  }

  const moveRef = (idx, direction) => {
    const targetIndex = idx + direction
    if (targetIndex < 0 || targetIndex >= project.visualRefs.length) return

    onChange(p => {
      const refs = [...p.visualRefs]
      const labels = [...(p.visualRefLabels || Array(6).fill(''))]
      ;[refs[idx], refs[targetIndex]] = [refs[targetIndex], refs[idx]]
      ;[labels[idx], labels[targetIndex]] = [labels[targetIndex], labels[idx]]
      return { ...p, visualRefs: refs, visualRefLabels: labels }
    })
  }

  return (
    <div className="project-info">
      <div className="section-header">
        <div className="section-title">Informasi Proyek</div>
        <div className="section-desc">Informasi umum tentang proyek</div>
      </div>

      <div className="form-grid">
        <Field label="Judul Proyek" value={project.title} onChange={v => set('title', v)} placeholder="mis. NEPTU" />
        <Field label="Sutradara" value={project.director} onChange={v => set('director', v)} placeholder="mis. Robert Armand" />
        <Field label="Penata Kamera (DOP)" value={project.dop} onChange={v => set('dop', v)} placeholder="mis. Nikolas Genta" />
        <Field label="Rumah Produksi" value={project.production} onChange={v => set('production', v)} placeholder="mis. Pitulungan Bahana Sinema" />
        <Field label="Genre" value={project.genre} onChange={v => set('genre', v)} placeholder="mis. Drama Psikologi" />
        <Field label="Durasi" value={project.duration} onChange={v => set('duration', v)} placeholder="e.g. 30 menit" />
        <Field label="Format Gambar" value={project.format} onChange={v => set('format', v)} placeholder="mis. UHD 4K" />
        <Field label="Rasio Aspek" value={project.aspectRatio} onChange={v => set('aspectRatio', v)} placeholder="mis. 2.39:1" />
        <Field label="Kamera Utama" value={project.camera} onChange={v => set('camera', v)} placeholder="mis. Sony FX3" />
        <Field label="Sistem Lensa" value={project.lensSystem} onChange={v => set('lensSystem', v)} placeholder="mis. Sony E-mount" />
      </div>

      <div className="divider" />

      <div className="section-header">
        <div className="section-title">Pendekatan Visual</div>
        <div className="section-desc">Arahan sinematografi dan pencahayaan</div>
      </div>

      <div className="form-grid full">
        <FieldArea
          label="Arahan Visual Umum"
          value={project.visualApproach}
          onChange={v => set('visualApproach', v)}
          placeholder="Jelaskan bahasa visual, gaya kamera, dan pendekatan movement..."
        />
        <FieldArea
          label="Arahan Pencahayaan Umum"
          value={project.lightingApproach}
          onChange={v => set('lightingApproach', v)}
          placeholder="Jelaskan pendekatan pencahayaan, mood, dan referensi utama..."
        />
      </div>

      <div className="divider" />

      <div className="section-header">
        <div className="section-title">Referensi Visual</div>
        <div className="section-desc">Referensi look & mood — klik untuk mengunggah</div>
      </div>

      <div className="visual-refs">
        {project.visualRefs.map((ref, i) => (
          <div key={i} className="visual-ref-item">
            <div
              className="visual-ref-card"
              role={ref ? 'group' : 'button'}
              tabIndex={ref ? -1 : 0}
              aria-label={ref ? `Referensi visual ${i + 1}` : `Tambah referensi visual ${i + 1}`}
              onClick={() => !ref && fileRefs.current[i]?.click()}
              onKeyDown={event => {
                if (!ref && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  fileRefs.current[i]?.click()
                }
              }}
            >
              {ref ? (
                <>
                  <img src={ref} alt={project.visualRefLabels?.[i] || `Referensi ${i + 1}`} />
                  <button
                    className="visual-ref-remove"
                    onClick={e => { e.stopPropagation(); removeRef(i) }}
                    aria-label={`Hapus referensi visual ${i + 1}`}
                    title="Hapus referensi"
                  >
                    <X size={10} />
                  </button>
                </>
              ) : (
                <div className="add-icon">
                  <Plus size={16} strokeWidth={1.5} />
                  <span>Tambah Referensi</span>
                </div>
              )}
              <input
                ref={el => fileRefs.current[i] = el}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleRefImg(i, e)}
              />
            </div>
            <div className="visual-ref-meta">
              <input
                className="visual-ref-caption"
                value={project.visualRefLabels?.[i] || ''}
                onChange={event => setRefLabel(i, event.target.value)}
                placeholder={`Label referensi ${i + 1}`}
                maxLength={100}
                aria-label={`Label referensi visual ${i + 1}`}
              />
              <div className="visual-ref-order">
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  onClick={() => moveRef(i, -1)}
                  disabled={i === 0}
                  title="Geser referensi ke kiri"
                  aria-label="Geser referensi ke kiri"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  onClick={() => moveRef(i, 1)}
                  disabled={i === project.visualRefs.length - 1}
                  title="Geser referensi ke kanan"
                  aria-label="Geser referensi ke kanan"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  const fieldId = useId()
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={300}
      />
    </div>
  )
}

function FieldArea({ label, value, onChange, placeholder }) {
  const fieldId = useId()
  return (
    <div className="field full">
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={5000}
      />
    </div>
  )
}
