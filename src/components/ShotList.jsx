import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react'

const SIZES = [
  'ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'LS', 'ELS', 'WS', 'EWS', 'W',
  'CU (OTS)', 'MCU (OTS)', 'ECU (OTS)', 'MS (OTS)', 'MLS (OTS)', 'LS (OTS)',
]
const CAMERAS = [
  'ARRI Alexa 35', 'ARRI Alexa Mini', 'ARRI Alexa Mini LF', 'ARRI Alexa LF',
  'ARRI Alexa 65', 'ARRI Amira', 'Sony FX3', 'Sony FX6', 'Sony FX9',
  'Sony VENICE', 'Sony VENICE 2', 'Sony BURANO',
  'Canon C70', 'Canon C80', 'Canon C200', 'Canon C300 Mark III',
  'Canon C400', 'Canon C500 Mark II', 'RED KOMODO', 'RED KOMODO-X',
  'RED V-RAPTOR', 'Blackmagic Pocket Cinema Camera 4K',
  'Blackmagic Pocket Cinema Camera 6K', 'Blackmagic URSA Mini Pro 12K',
  'Panasonic VariCam', 'Panasonic EVA1', 'DJI Ronin 4D', 'iPhone',
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
  '28–70 mm', '70–200 mm', 'TBD', 'Custom…',
]
const MOVEMENTS = [
  'Static', 'Pan', 'Pan L', 'Pan R', 'Whip Pan', 'Tilt', 'Tilt Up', 'Tilt Down',
  'Pedestal', 'Pedestal Up', 'Pedestal Down', 'Dolly', 'Dolly In', 'Dolly Out',
  'Truck', 'Truck L', 'Truck R', 'Arc', 'Orbit', 'Tracking Shot', 'Tracking',
  'Crane / Boom', 'Crane Up', 'Crane Down', 'Jib Up', 'Jib Down', 'Zoom',
  'Rack Focus', 'Steadicam', 'Handheld', 'Floating', 'Slider', 'Roll', 'Push In',
  'Pull Out', 'Blocking',
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

export default function ShotList({ scenes, onChange, defaultShot, defaultScene }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const scene = scenes[activeIdx]

  const updateScene = (fn) => {
    onChange(prev => prev.map((s, i) => i === activeIdx ? fn(s) : s))
  }

  const addScene = () => {
    const newScene = defaultScene(scenes.length + 1)
    onChange(prev => [...prev, newScene])
    setActiveIdx(scenes.length)
  }

  const deleteScene = (idx) => {
    if (scenes.length === 1) return
    onChange(prev => prev.filter((_, i) => i !== idx))
    setActiveIdx(Math.max(0, idx - 1))
  }

  const addShot = () => {
    updateScene(s => ({
      ...s,
      shots: [...s.shots, defaultShot(s.shots.length + 1)]
    }))
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
      shots: s.shots.filter(sh => sh.id !== shotId)
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
                value={scene.name}
                onChange={e => updateSceneMeta('name', e.target.value)}
                style={{ border: 'none', fontWeight: 500, fontSize: 13, padding: '4px 0', outline: 'none', background: 'transparent', minWidth: 0 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
              <select
                className="cell-select"
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
                onChange={e => updateSceneMeta('location', e.target.value)}
                placeholder="Location"
                style={{ fontSize: 12, color: 'var(--text-muted)', border: 'none', outline: 'none', background: 'transparent', width: 140 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
              <select
                className="cell-select"
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
              onClick={() => setActiveIdx(i)}
            >
              <div className="scene-item-name">{s.name}</div>
              <div className="scene-item-sub">{s.intExt}. {s.location || 'No location'} — {s.dayNight}</div>
            </div>
          ))}
        </div>

        <div className="shot-table-wrap">
          <datalist id="camera-options">
            {CAMERAS.map(option => <option key={option} value={option} />)}
          </datalist>
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
                <th style={{ width: 36 }}></th>
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
                    <input className="cell-input" list="camera-options" value={shot.camera} onChange={e => updateShot(shot.id, 'camera', e.target.value)} placeholder="Camera" aria-label="Camera model (choose or type)" />
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
                    <SelectCell value={shot.equipment ?? shot.support ?? ''} onChange={v => updateShot(shot.id, 'equipment', v)} options={EQUIPMENT} placeholder="Equipment" />
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
                    <button
                      className="btn btn-danger"
                      style={{ padding: '8px', opacity: 0.4 }}
                      onClick={() => deleteShot(shot.id)}
                      title="Delete shot"
                    >
                      <Trash2 size={12} />
                    </button>
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
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
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
