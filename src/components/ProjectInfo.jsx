import { useRef } from 'react'
import { Plus, X } from 'lucide-react'

export default function ProjectInfo({ project, onChange }) {
  const set = (key, val) => onChange(p => ({ ...p, [key]: val }))
  const fileRefs = useRef([])

  const handleRefImg = (idx, e) => {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    onChange(p => {
      const refs = [...p.visualRefs]
      refs[idx] = url
      return { ...p, visualRefs: refs }
    })
  }

  const removeRef = (idx) => {
    onChange(p => {
      const refs = [...p.visualRefs]
      refs[idx] = null
      return { ...p, visualRefs: refs }
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
          <div
            key={i}
            className="visual-ref-card"
            onClick={() => !ref && fileRefs.current[i]?.click()}
          >
            {ref ? (
              <>
                <img src={ref} alt={`Reference ${i + 1}`} />
                <button
                  className="visual-ref-remove"
                  onClick={e => { e.stopPropagation(); removeRef(i) }}
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
