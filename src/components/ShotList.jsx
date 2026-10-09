import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, X, Trash2, Copy } from 'lucide-react'

const SIZES = [
  'Extreme Wide Shot (EWS)', 'Wide Shot (WS)', 'Long Shot (LS)',
  'Medium Long Shot (MLS)', 'Medium Shot (MS)', 'Medium Full Shot (MFS)',
  'Medium Close-Up (MCU)', 'Close-Up (CU)', 'Big Close-Up (BCU)',
  'Extreme Close-Up (ECU)', 'Extreme Extreme Close-Up (XCU)',
  'Two Shot', 'Three Shot', 'Group Shot', 'Over-the-Shoulder (OTS)',
  'Insert', 'Cutaway', 'Establishing Shot',
]
const ANGLES = [
  'Eye Level', 'Low Angle', 'High Angle', 'Extreme Low', 'Extreme High',
  'Dutch Tilt', 'POV', "Bird's Eye", "Worm's Eye", 'Overhead',
  'Shoulder Level', 'Hip Level', 'Ground Level', 'Profile',
  'Three-Quarter', 'Over-the-Shoulder',
]
const LENSES = [
  '14 mm', '15 mm', '16 mm', '18 mm', '20 mm', '21 mm', '24 mm', '25 mm',
  '28 mm', '29 mm', '32 mm', '35 mm', '40 mm', '50 mm', '65 mm', '75 mm',
  '85 mm', '100 mm', '105 mm', '135 mm', '150 mm', '180 mm', '200 mm',
  '14–24 mm', '16–35 mm', '17–28 mm', '24–70 mm', '24–105 mm',
  '28–70 mm', '70–200 mm', 'TBD',
]
const MOVEMENTS = [
  'Static', 'Pan', 'Pan Left', 'Pan Right', 'Whip Pan',
  'Tilt Up', 'Tilt Down', 'Dutch Roll', 'Pedestal Up', 'Pedestal Down',
  'Dolly In', 'Dolly Out', 'Truck Left', 'Truck Right', 'Tracking Shot',
  'Follow', 'Lead', 'Arc', 'Orbit', 'Crane Up', 'Crane Down',
  'Jib Up', 'Jib Down', 'Zoom In', 'Zoom Out', 'Dolly Zoom',
  'Push In', 'Pull Out', 'Rack Focus', 'Roll', 'Reveal', 'Reframe',
  'Handheld Movement', 'POV Movement', '360 Orbit', 'Blocking',
]
const EQUIPMENT = [
  'Sticks / Tripod', 'Handheld', 'Shoulder Rig', 'Easyrig', 'Monopod',
  'Steadicam', 'Gimbal', 'DJI Ronin / MOVI', 'Slider', 'Dolly', 'Dana Dolly',
  'Doorway Dolly', 'Jib Arm', 'Crane / Boom', 'Technocrane', 'Condor / Cherry Picker',
  'Hi-Hat', 'Baby Legs', 'Remote Head', 'Camera Car', 'Russian Arm', 'Drone',
  'Helicam', 'Cable Cam', 'Suction Mount', 'Body Mount', 'Wheelchair Rig',
  'Underwater Housing', 'Snorricam', 'Motion Control', 'Turntable', 'Probe Lens Rig',
]
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

export default function ShotList({
  scenes,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  defaultShot,
  defaultScene,
}) {
  const matchingIdx = scenes.findIndex(s => s.id === activeSceneId)
  const activeIdx = matchingIdx >= 0 ? matchingIdx : 0
  const scene = scenes[activeIdx]

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
    if (!window.confirm('Delete this scene and all of its shots? This cannot be undone.')) return

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="scene-select"
                aria-label="Scene name"
                value={scene.name}
                onChange={e => updateSceneMeta('name', e.target.value)}
                style={{ border: 'none', fontWeight: 500, fontSize: 13, padding: '4px 0', outline: 'none', background: 'transparent', minWidth: 0 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
              <select
                className="cell-select"
                aria-label="Interior or exterior"
                value={scene.intExt}
                onChange={e => updateSceneMeta('intExt', e.target.value)}
                style={{ fontSize: 12, color: 'var(--text-muted)', width: 'auto', padding: '4px 4px' }}
              >
                <option>INT</option>
                <option>EXT</option>
                <option>INT/EXT</option>
              </select>
              <input
                value={scene.location}
                aria-label="Scene location"
                onChange={e => updateSceneMeta('location', e.target.value)}
                placeholder="Location"
                style={{ fontSize: 12, color: 'var(--text-muted)', border: 'none', outline: 'none', background: 'transparent', width: 140 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
              <select
                className="cell-select"
                aria-label="Scene time of day"
                value={scene.dayNight}
                onChange={e => updateSceneMeta('dayNight', e.target.value)}
                style={{ fontSize: 12, color: 'var(--text-muted)', width: 'auto', padding: '4px 4px' }}
              >
                <option>DAY</option>
                <option>NIGHT</option>
                <option>DAWN</option>
                <option>DUSK</option>
              </select>
            </div>
            <div className="shot-count">{scene.shots.length} shot{scene.shots.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => deleteScene(activeIdx)}
            disabled={scenes.length <= 1}
            title={scenes.length <= 1 ? 'Keep at least one scene' : 'Delete current scene'}
          >
            <Trash2 size={13} /> Delete Scene
          </button>
          <button className="btn btn-secondary" onClick={addScene}>
            <Plus size={13} /> New Scene
          </button>
        </div>
      </div>

      <div className="shotlist-layout">
        <div className="scene-sidebar">
          <div className="scene-sidebar-header">
            Scenes
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
              <div className="scene-item-sub">{s.intExt}. {s.location || 'No location'} — {s.dayNight}</div>
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
                <th style={{ width: 52 }}>Shot</th>
                <th style={{ minWidth: 100 }}>Subject</th>
                <th style={{ width: 80 }}>Size</th>
                <th style={{ width: 90 }}>Camera</th>
                <th style={{ width: 100 }}>Angle</th>
                <th style={{ width: 80 }}>Lens</th>
                <th style={{ minWidth: 140 }}>Movement</th>
                <th style={{ minWidth: 140 }}>Equipment</th>
                <th style={{ width: 90 }}>Sound</th>
                <th style={{ width: 60 }}>Take</th>
                <th style={{ width: 60 }}>Script</th>
                <th style={{ width: 70 }}>Setup</th>
                <th style={{ width: 80 }}>Est. Shoot</th>
                <th style={{ minWidth: 120 }}>Notes</th>
                <th style={{ width: 116 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scene.shots.map((shot) => (
                <tr key={shot.id}>
                  <td><div className="shot-num">#{shot.num}</div></td>
                  <td>
                    <input className="cell-input" value={shot.subject} onChange={e => updateShot(shot.id, 'subject', e.target.value)} placeholder="Subject" />
                  </td>
                  <td>
                    <SelectCell value={shot.size} onChange={v => updateShot(shot.id, 'size', v)} options={SIZES} placeholder="Size" />
                  </td>
                  <td>
                    <input className="cell-input" value={shot.camera} onChange={e => updateShot(shot.id, 'camera', e.target.value)} placeholder="Camera" />
                  </td>
                  <td>
                    <SelectCell value={shot.angle} onChange={v => updateShot(shot.id, 'angle', v)} options={ANGLES} placeholder="Angle" />
                  </td>
                  <td>
                    <input className="cell-input" list="lens-options" value={shot.lens} onChange={e => updateShot(shot.id, 'lens', e.target.value)} placeholder="Choose / type" aria-label="Lens focal length (choose or type)" />
                  </td>
                  <td>
                    <div className="movement-cell">
                      {shot.movements.map(m => (
                        <span key={m} className="movement-tag">
                          {m}
                          <button onClick={() => removeMovement(shot.id, m)}><X size={9} /></button>
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
                    <SelectCell value={shot.sound} onChange={v => updateShot(shot.id, 'sound', v)} options={SOUNDS} placeholder="Sound" />
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
                    <input className="cell-input" value={shot.notes} onChange={e => updateShot(shot.id, 'notes', e.target.value)} placeholder="Notes..." />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => moveShot(shot.id, -1)}
                        disabled={scene.shots[0]?.id === shot.id}
                        title="Move shot up"
                        aria-label="Move shot up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => moveShot(shot.id, 1)}
                        disabled={scene.shots[scene.shots.length - 1]?.id === shot.id}
                        title="Move shot down"
                        aria-label="Move shot down"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 4 }}
                        onClick={() => duplicateShot(shot.id)}
                        title="Duplicate shot"
                        aria-label="Duplicate shot"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: 4 }}
                        onClick={() => {
                          if (window.confirm('Delete this shot? This cannot be undone.')) deleteShot(shot.id)
                        }}
                        title="Delete shot"
                        aria-label="Delete shot"
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
                    <Plus size={13} /> Add Shot
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
      className="cell-select"
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
