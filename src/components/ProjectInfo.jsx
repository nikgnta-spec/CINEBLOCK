import { useRef } from 'react'
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
      window.alert('The selected image could not be loaded. Please try another image.')
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
        <div className="section-title">Project Information</div>
        <div className="section-desc">General details about the project</div>
      </div>

      <div className="form-grid">
        <Field label="Title" value={project.title} onChange={v => set('title', v)} placeholder="e.g. NEPTU" />
        <Field label="Director" value={project.director} onChange={v => set('director', v)} placeholder="e.g. Robert Armand" />
        <Field label="Director of Photography" value={project.dop} onChange={v => set('dop', v)} placeholder="e.g. Nikolas Genta" />
        <Field label="Production Company" value={project.production} onChange={v => set('production', v)} placeholder="e.g. Pitulungan Bahana Sinema" />
        <Field label="Genre" value={project.genre} onChange={v => set('genre', v)} placeholder="e.g. Drama Psikologi" />
        <Field label="Duration" value={project.duration} onChange={v => set('duration', v)} placeholder="e.g. 30 menit" />
        <Field label="Format" value={project.format} onChange={v => set('format', v)} placeholder="e.g. UHD 4K" />
        <Field label="Aspect Ratio" value={project.aspectRatio} onChange={v => set('aspectRatio', v)} placeholder="e.g. 2.39:1" />
        <Field label="Camera" value={project.camera} onChange={v => set('camera', v)} placeholder="e.g. Canon C50" />
        <Field label="Lens System" value={project.lensSystem} onChange={v => set('lensSystem', v)} placeholder="e.g. Canon EF" />
      </div>

      <div className="divider" />

      <div className="section-header">
        <div className="section-title">Visual Approach</div>
        <div className="section-desc">General cinematography and lighting direction</div>
      </div>

      <div className="form-grid full">
        <FieldArea
          label="General Visual Approach"
          value={project.visualApproach}
          onChange={v => set('visualApproach', v)}
          placeholder="Describe the visual language, camera style, and movement approach..."
        />
        <FieldArea
          label="General Lighting Approach"
          value={project.lightingApproach}
          onChange={v => set('lightingApproach', v)}
          placeholder="Describe the lighting philosophy, mood, and key references..."
        />
      </div>

      <div className="divider" />

      <div className="section-header">
        <div className="section-title">Visual References</div>
        <div className="section-desc">Look & mood references — click to upload</div>
      </div>

      <div className="visual-refs">
        {project.visualRefs.map((ref, i) => (
          <div key={i} className="visual-ref-item">
            <div
              className="visual-ref-card"
              role={ref ? 'group' : 'button'}
              tabIndex={ref ? -1 : 0}
              aria-label={ref ? `Visual reference ${i + 1}` : `Add visual reference ${i + 1}`}
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
                  <img src={ref} alt={project.visualRefLabels?.[i] || `Reference ${i + 1}`} />
                  <button
                    className="visual-ref-remove"
                    onClick={e => { e.stopPropagation(); removeRef(i) }}
                    aria-label={`Remove visual reference ${i + 1}`}
                    title="Remove reference"
                  >
                    <X size={10} />
                  </button>
                </>
              ) : (
                <div className="add-icon">
                  <Plus size={16} strokeWidth={1.5} />
                  <span>Add Reference</span>
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
                placeholder={`Reference ${i + 1} label`}
                maxLength={100}
                aria-label={`Label for visual reference ${i + 1}`}
              />
              <div className="visual-ref-order">
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  onClick={() => moveRef(i, -1)}
                  disabled={i === 0}
                  title="Move reference left"
                  aria-label="Move reference left"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  onClick={() => moveRef(i, 1)}
                  disabled={i === project.visualRefs.length - 1}
                  title="Move reference right"
                  aria-label="Move reference right"
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
  return (
    <div className="field">
      <label>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function FieldArea({ label, value, onChange, placeholder }) {
  return (
    <div className="field full">
      <label>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />
    </div>
  )
}
