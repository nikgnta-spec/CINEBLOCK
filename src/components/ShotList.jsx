import { useEffect, useState } from 'react'
import { SIZES, ANGLES, LENSES, MOVEMENTS, EQUIPMENT } from '../shotOptions'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, X, Trash2, Copy } from 'lucide-react'






const SOUNDS = [
  'Boom', 'Lav', 'Lav + Boom', 'Lavs + Boom', 'Plant Mic', 'Wireless Boom',
  'Wired Boom', 'MOS', 'Playback', 'Wild Track', 'None',
]

function renumberShots(shots) {
  return shots.map((shot, index) => ({
    ...shot,
    num: String(index + 1).padStart(3, '0'),
  }))
}

function durationMinutes(value) {
  const input = String(value ?? '').trim().toLowerCase()
  if (!input) return 0
  const clock = input.match(/^(\d+):([0-5]\d)$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const parts = [...input.matchAll(/(\d+(?:[.,]\d+)?)\s*(jam|hours?|hrs?|h|menit|minutes?|mins?|min|m)?/g)]
    .filter(match => match[0].trim())
  return parts.reduce((total, match) => {
    const amount = Number(match[1].replace(',', '.'))
    const unit = match[2] || ''
    return total + amount * (['jam', 'hour', 'hours', 'hr', 'hrs', 'h'].includes(unit) ? 60 : 1)
  }, 0)
}

function formatDuration(value) {
  const minutes = Math.round(value)
  if (!minutes) return '0 mnt'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return hours + ' j ' + remainder + ' mnt'
  if (hours) return hours + ' j'
  return minutes + ' mnt'
}

export default function ShotList({
  scenes,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  defaultShot,
  defaultScene,
  selectedShotId,
  onSelectedShotIdChange,
}) {
  const matchingIdx = scenes.findIndex(s => s.id === activeSceneId)
  const activeIdx = matchingIdx >= 0 ? matchingIdx : 0
  const scene = scenes[activeIdx]
  const totalSetupMinutes = scene.shots.reduce((sum, shot) => sum + durationMinutes(shot.setup), 0)
  const totalShootMinutes = scene.shots.reduce((sum, shot) => sum + durationMinutes(shot.estShoot), 0)

  useEffect(() => {
    if (!selectedShotId || !scene?.shots.some(shot => shot.id === selectedShotId)) return
    const rows = Array.from(document.querySelectorAll('[data-shot-id]'))
    rows.find(row => row.dataset.shotId === selectedShotId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedShotId, scene?.id])

  const setActiveIdx = (nextIdxOrUpdater) => {
    const nextIdx = typeof nextIdxOrUpdater === 'function'
      ? nextIdxOrUpdater(activeIdx)
      : nextIdxOrUpdater
    const nextScene = scenes[nextIdx]
    if (nextScene) onActiveSceneChange(nextScene.id)
  }

  const updateScene = (fn) => {
    onChange(prev => prev.map(s => s.id === scene.id ? fn(s) : s))
  }

  const nextSceneName = () => {
    const usedNumbers = new Set(
      scenes.map(s => Number(s.name.match(/^Scene\s+(\d+)$/i)?.[1])).filter(Number.isFinite),
    )
    let candidate = 1
    while (usedNumbers.has(candidate)) candidate += 1
    return candidate
  }

  const addScene = () => {
    const newScene = defaultScene(nextSceneName())
    onChange(prev => [...prev, newScene])
    onActiveSceneChange(newScene.id)
  }

  const deleteScene = (idx) => {
    if (scenes.length <= 1) return
    if (!window.confirm('Hapus scene ini beserta semua shot di dalamnya? Tindakan ini tidak dapat dibatalkan.')) return

    const fallbackIndex = idx === 0 ? 1 : idx - 1
    const fallbackScene = scenes[fallbackIndex]
    const sceneToDelete = scenes[idx]
    if (!sceneToDelete) return

    onChange(prev => prev.filter(s => s.id !== sceneToDelete.id))
    onActiveSceneChange(fallbackScene?.id || '')
  }

  const nextShotNumber = (shots) => {
    const numbers = shots.map(shot => Number.parseInt(shot.num, 10)).filter(Number.isFinite)
    return String(Math.max(0, ...numbers) + 1).padStart(3, '0')
  }

  const addShot = () => {
    updateScene(s => ({
      ...s,
      shots: [...s.shots, defaultShot(nextShotNumber(s.shots))]
    }))
  }

  const duplicateShot = (shotId) => {
    updateScene(s => {
      const index = s.shots.findIndex(shot => shot.id === shotId)
      if (index < 0) return s
      const original = s.shots[index]
      const copy = {
        ...original,
        id: crypto.randomUUID(),
        num: nextShotNumber(s.shots),
        movements: [...(original.movements || [])],
        equipment: [...(Array.isArray(original.equipment) ? original.equipment : original.equipment ? [original.equipment] : [])],
      }
      const shots = [...s.shots]
      shots.splice(index + 1, 0, copy)
      return { ...s, shots: renumberShots(shots) }
    })
  }

  const moveShot = (shotId, direction) => {
    updateScene(s => {
      const index = s.shots.findIndex(shot => shot.id === shotId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= s.shots.length) return s
      const shots = [...s.shots]
      ;[shots[index], shots[targetIndex]] = [shots[targetIndex], shots[index]]
      return { ...s, shots: renumberShots(shots) }
    })
  }

  const updateShot = (shotId, key, val) => {
    updateScene(s => ({
      ...s,
      shots: s.shots.map(sh => sh.id === shotId ? { ...sh, [key]: val } : sh)
    }))
  }

  const deleteShot = (shotId) => {
    updateScene(s => ({
      ...s,
      shots: renumberShots(s.shots.filter(sh => sh.id !== shotId))
    }))
  }

  const addMovement = (shotId, mov) => {
    updateScene(s => ({
      ...s,
      shots: s.shots.map(sh =>
        sh.id === shotId && !sh.movements.includes(mov)
          ? { ...sh, movements: [...sh.movements, mov] }
          : sh
      )
    }))
  }

  const removeMovement = (shotId, mov) => {
    updateScene(s => ({
      ...s,
      shots: s.shots.map(sh =>
        sh.id === shotId
          ? { ...sh, movements: sh.movements.filter(m => m !== mov) }
          : sh
      )
    }))
  }

  const addEquipment = (shotId, equipment) => {
    updateScene(s => ({
      ...s,
      shots: s.shots.map(sh => {
        const current = Array.isArray(sh.equipment) ? sh.equipment : sh.equipment ? [sh.equipment] : []
        return sh.id === shotId && !current.includes(equipment)
          ? { ...sh, equipment: [...current, equipment] }
          : sh
      })
    }))
  }

  const removeEquipment = (shotId, equipment) => {
    updateScene(s => ({
      ...s,
      shots: s.shots.map(sh => {
        const current = Array.isArray(sh.equipment) ? sh.equipment : sh.equipment ? [sh.equipment] : []
        return sh.id === shotId
          ? { ...sh, equipment: current.filter(item => item !== equipment) }
          : sh
      })
    }))
  }

  const updateSceneMeta = (key, val) => {
    updateScene(s => ({ ...s, [key]: val }))
  }

  return (
    <div className="shotlist-page">
      <div className="shotlist-toolbar">
        <div className="shotlist-toolbar-left">
          <div className="scene-nav">
            <button
              className="scene-nav-btn"
              onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
              disabled={activeIdx === 0}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="scene-nav-btn"
              onClick={() => setActiveIdx(i => Math.min(scenes.length - 1, i + 1))}
              disabled={activeIdx === scenes.length - 1}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div>
            <div className="scene-slugline">
              <input
                className="scene-select"
                aria-label="Nama scene"
                value={scene.name}
                onChange={e => updateSceneMeta('name', e.target.value)}
                style={{ border: 'none', fontWeight: 500, fontSize: 13, padding: '4px 0', outline: 'none', background: 'transparent', minWidth: 0 }}
              />
              <span className="scene-slugline-separator" aria-hidden="true">·</span>
              <select
                className="cell-select scene-slugline-field"
                aria-label="Interior atau eksterior"
                value={scene.intExt}
                onChange={e => updateSceneMeta('intExt', e.target.value)}
              >
                <option>INT</option>
                <option>EXT</option>
                <option>INT/EXT</option>
              </select>
              <input
                value={scene.location}
                aria-label="Lokasi scene"
                onChange={e => updateSceneMeta('location', e.target.value)}
                placeholder="Lokasi"
                className="scene-location-field"
              />
              <span className="scene-slugline-separator" aria-hidden="true">·</span>
              <select
                className="cell-select scene-slugline-field"
                aria-label="Waktu scene"
                value={scene.dayNight}
                onChange={e => updateSceneMeta('dayNight', e.target.value)}
              >
                <option>DAY</option>
                <option>NIGHT</option>
                <option>DAWN</option>
                <option>DUSK</option>
              </select>
            </div>
            <div className="scene-meta-row">
              <span className="shot-count">{scene.shots.length} shot</span>
              <div className="shot-time-summary" aria-label="Ringkasan estimasi waktu scene">
                <span>Setup <strong>{formatDuration(totalSetupMinutes)}</strong></span>
                <span>Shoot <strong>{formatDuration(totalShootMinutes)}</strong></span>
                <span>Total <strong>{formatDuration(totalSetupMinutes + totalShootMinutes)}</strong></span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => deleteScene(activeIdx)}
            disabled={scenes.length <= 1}
            title={scenes.length <= 1 ? 'Minimal harus ada satu scene' : 'Hapus scene ini'}
          >
            <Trash2 size={13} /> Hapus Scene
          </button>
          <button className="btn btn-secondary" onClick={addScene}>
            <Plus size={13} /> Scene Baru
          </button>
        </div>
      </div>

      <div className="shotlist-layout">
        <div className="scene-sidebar">
          <div className="scene-sidebar-header">
            Scene
            <button className="btn-ghost btn" style={{ padding: '2px 4px' }} onClick={addScene}>
              <Plus size={12} />
            </button>
          </div>
          {scenes.map((s, i) => (
            <div
              key={s.id}
              className={`scene-item${i === activeIdx ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={i === activeIdx}
              onClick={() => setActiveIdx(i)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveIdx(i)
                }
              }}
            >
              <div className="scene-item-name">{s.name}</div>
              <div className="scene-item-sub">{s.intExt}{s.location ? `. ${s.location}` : ''} · {s.dayNight}</div>
            </div>
          ))}
        </div>

        <div className="shot-table-wrap">
          <datalist id="lens-options">
            {LENSES.map(option => <option key={option} value={option} />)}
          </datalist>
          <table className="shot-table">
            <thead>
              <tr>
                <th style={{ width: 62 }}>Shot</th>
                <th style={{ minWidth: 160 }}>Subjek</th>
                <th style={{ width: 104 }}>Ukuran</th>
                <th style={{ width: 126 }}>Kamera</th>
                <th style={{ width: 110 }}>Angle</th>
                <th style={{ width: 124 }}>Lens</th>
                <th style={{ minWidth: 156 }}>Movement</th>
                <th style={{ minWidth: 156 }}>Equipment</th>
                <th style={{ width: 108 }}>Audio</th>
                <th style={{ width: 72 }}>Take</th>
                <th style={{ width: 82 }}>Naskah</th>
                <th style={{ width: 90 }}>Setup</th>
                <th style={{ width: 112 }}>Estimasi Shoot</th>
                <th style={{ minWidth: 160 }}>Catatan</th>
                <th className="shot-col-actions" style={{ width: 132 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {scene.shots.map((shot) => (
                <tr key={shot.id} data-shot-id={shot.id} className={selectedShotId === shot.id ? 'shot-row is-selected' : 'shot-row'} onClick={() => onSelectedShotIdChange?.(shot.id)}>
                  <td><div className="shot-num">{shot.num}</div></td>
                  <td>
                    <input className="cell-input" value={shot.subject} onChange={e => updateShot(shot.id, 'subject', e.target.value)} placeholder="Subjek" />
                  </td>
                  <td>
                    <SelectCell value={shot.size} onChange={v => updateShot(shot.id, 'size', v)} options={SIZES} placeholder="Ukuran" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.camera} onChange={e => updateShot(shot.id, 'camera', e.target.value)} placeholder="Kamera" />
                  </td>
                  <td>
                    <SelectCell value={shot.angle} onChange={v => updateShot(shot.id, 'angle', v)} options={ANGLES} placeholder="Angle" />
                  </td>
                  <td>
                    <input className="cell-input" list="lens-options" value={shot.lens} onChange={e => updateShot(shot.id, 'lens', e.target.value)} placeholder="Pilih atau ketik" aria-label="Panjang fokus lensa (pilih atau ketik)" />
                  </td>
                  <td>
                    <div className="movement-cell">
                      {shot.movements.map(m => (
                        <span key={m} className="movement-tag">
                          {m === 'Handheld Movement' ? 'Handheld' : m}
                          <button
                            onClick={() => removeMovement(shot.id, m)}
                            title={`Hapus movement ${m}`}
                            aria-label={`Hapus movement ${m}`}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      <MovementPicker
                        onPick={m => addMovement(shot.id, m)}
                        existing={shot.movements}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="movement-cell">
                      {(Array.isArray(shot.equipment) ? shot.equipment : shot.equipment ? [shot.equipment] : shot.support ? [shot.support] : []).map(item => (
                        <span key={item} className="movement-tag">
                          {item}
                          <button onClick={() => removeEquipment(shot.id, item)} title={`Remove ${item}`} aria-label={`Remove ${item}`}>
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      <EquipmentPicker
                        onPick={item => addEquipment(shot.id, item)}
                        existing={Array.isArray(shot.equipment) ? shot.equipment : shot.equipment ? [shot.equipment] : shot.support ? [shot.support] : []}
                      />
                    </div>
                  </td>
                  <td>
                    <SelectCell value={shot.sound} onChange={v => updateShot(shot.id, 'sound', v)} options={SOUNDS} placeholder="Audio" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.take} onChange={e => updateShot(shot.id, 'take', e.target.value)} placeholder="1" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.script} onChange={e => updateShot(shot.id, 'script', e.target.value)} placeholder="1/8" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.setup} onChange={e => updateShot(shot.id, 'setup', e.target.value)} placeholder="15m" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.estShoot} onChange={e => updateShot(shot.id, 'estShoot', e.target.value)} placeholder="10m" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.notes} onChange={e => updateShot(shot.id, 'notes', e.target.value)} placeholder="Catatan..." />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => moveShot(shot.id, -1)}
                        disabled={scene.shots[0]?.id === shot.id}
                        title="Pindahkan shot ke atas"
                        aria-label="Pindahkan shot ke atas"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => moveShot(shot.id, 1)}
                        disabled={scene.shots[scene.shots.length - 1]?.id === shot.id}
                        title="Pindahkan shot ke bawah"
                        aria-label="Pindahkan shot ke bawah"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => duplicateShot(shot.id)}
                        title="Duplikat shot"
                        aria-label="Duplikat shot"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: 4 }}
                        onClick={() => {
                          if (window.confirm('Hapus shot ini? Tindakan ini tidak dapat dibatalkan.')) deleteShot(shot.id)
                        }}
                        title="Hapus shot"
                        aria-label="Hapus shot"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="add-shot-row">
                <td colSpan={15}>
                  <button className="add-shot-btn" onClick={addShot}>
                    <Plus size={13} /> Tambah Shot
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SelectCell({ value, onChange, options, placeholder }) {
  return (
    <select
      className={'cell-select' + (value ? '' : ' is-placeholder')}
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function EquipmentPicker({ onPick, existing }) {
  const [open, setOpen] = useState(false)
  const available = EQUIPMENT.filter(item => !existing.includes(item))

  if (available.length === 0) return null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className="add-movement" onClick={() => setOpen(value => !value)}>+ Equipment</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 100,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: 180,
          maxHeight: 260,
          overflowY: 'auto',
          padding: '4px 0',
        }}>
          {available.map(item => (
            <button
              key={item}
              onClick={() => { onPick(item); setOpen(false) }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--text)',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MovementPicker({ onPick, existing }) {
  const [open, setOpen] = useState(false)
  const available = MOVEMENTS.filter(m => !existing.includes(m))

  if (available.length === 0) return null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className="add-movement" onClick={() => setOpen(o => !o)}>+ Movement</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 100,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: 160,
          maxHeight: 260,
          overflowY: 'auto',
          padding: '4px 0',
        }}>
          {available.map(m => (
            <button
              key={m}
              onClick={() => { onPick(m); setOpen(false) }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--text)',
              }}
              onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.target.style.background = ''}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
