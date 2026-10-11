import { useEffect, useState } from 'react'
import SceneNavigator from './SceneNavigator'
import { SIZES, ANGLES, LENSES, MOVEMENTS, EQUIPMENT } from '../shotOptions'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, X, Trash2, Copy, Check, CircleSlash, ImagePlus, LayoutGrid, List } from 'lucide-react'






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

async function prepareStoryboardImage(file) {
  if (!file) return ''
  if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar untuk storyboard.')
  if (file.size > 12 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 12 MB.')

  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Gambar tidak bisa dibuka. Coba file gambar lain.'))
      element.src = sourceUrl
    })
    const maxDimension = 1000
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak bisa memproses gambar ini.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('Gambar tidak bisa diproses.')
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Gambar tidak bisa disimpan.'))
      reader.onerror = () => reject(new Error('Gambar tidak bisa disimpan.'))
      reader.readAsDataURL(blob)
    })
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function statusLabel(status) {
  if (status === 'done') return 'Done'
  if (status === 'skip') return 'Skip'
  return 'Rencana'
}

export default function ShotList({
  scenes,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  floorplans,
  defaultShot,
  selectedShotId,
  onAddScene,
  onRenameScene,
  onFloorplansChange,
  onSelectedShotIdChange,
}) {
  const [viewMode, setViewMode] = useState('table')
  const [previewShot, setPreviewShot] = useState(null)
  const matchingIdx = scenes.findIndex(s => s.id === activeSceneId)
  const activeIdx = matchingIdx >= 0 ? matchingIdx : 0
  const scene = scenes[activeIdx]
  const totalSetupMinutes = scene.shots.reduce((sum, shot) => sum + durationMinutes(shot.setup), 0)
  const totalShootMinutes = scene.shots.reduce((sum, shot) => sum + durationMinutes(shot.estShoot), 0)

  useEffect(() => {
    if (!previewShot) return
    const closeOnEscape = event => {
      if (event.key === 'Escape') setPreviewShot(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [previewShot])

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

  const deleteScene = (idx) => {
    if (scenes.length <= 1) return
    if (!window.confirm('Hapus scene ini beserta semua shot di dalamnya? Tindakan ini tidak dapat dibatalkan.')) return

    const fallbackIndex = idx === 0 ? 1 : idx - 1
    const fallbackScene = scenes[fallbackIndex]
    const sceneToDelete = scenes[idx]
    if (!sceneToDelete) return

    onChange(prev => prev.filter(s => s.id !== sceneToDelete.id))
    onFloorplansChange?.(previous => {
      const next = { ...previous }
      delete next[sceneToDelete.id]
      return next
    })
    if (sceneToDelete.shots.some(shot => shot.id === selectedShotId)) onSelectedShotIdChange?.('')
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
        status: 'planned',
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

  const handleStoryboardUpload = async (shotId, file) => {
    if (!file) return
    try {
      const image = await prepareStoryboardImage(file)
      updateShot(shotId, 'storyboardImage', image)
    } catch (error) {
      window.alert(error.message || 'Storyboard tidak dapat ditambahkan.')
    }
  }

  const removeStoryboard = shotId => {
    updateShot(shotId, 'storyboardImage', '')
    setPreviewShot(current => current?.id === shotId ? null : current)
  }

  const setShotStatus = (shotId, nextStatus) => {
    const current = scene.shots.find(shot => shot.id === shotId)
    if (!current) return
    updateShot(shotId, 'status', current.status === nextStatus ? 'planned' : nextStatus)
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
              <span className="scene-current-name">{scene.name}</span>
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
        <div className="shotlist-toolbar-actions">
          <div className="shot-view-toggle" role="group" aria-label="Tampilan Shot List">
            <button type="button" className={'shot-view-toggle-button' + (viewMode === 'table' ? ' active' : '')} onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'}>
              <List size={15} /><span>Tabel</span>
            </button>
            <button type="button" className={'shot-view-toggle-button' + (viewMode === 'storyboard' ? ' active' : '')} onClick={() => setViewMode('storyboard')} aria-pressed={viewMode === 'storyboard'}>
              <LayoutGrid size={15} /><span>Storyboard</span>
            </button>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => deleteScene(activeIdx)}
            disabled={scenes.length <= 1}
            title={scenes.length <= 1 ? 'Minimal harus ada satu scene' : 'Hapus scene ini'}
          >
            <Trash2 size={13} /> Hapus Scene
          </button>
        </div>
      </div>

      <div className="shotlist-layout">
        <SceneNavigator
          mode="list"
          scenes={scenes}
          activeSceneId={activeSceneId}
          onActiveSceneChange={onActiveSceneChange}
          onAddScene={onAddScene}
          onRenameScene={onRenameScene}
        />

        {viewMode === 'table' ? (
        <div className="shot-table-wrap">
          <datalist id="lens-options">
            {LENSES.map(option => <option key={option} value={option} />)}
          </datalist>
          <table className="shot-table">
            <thead>
              <tr>
                <th style={{ width: 62 }}>Shot</th>
                <th style={{ minWidth: 160 }}>Subjek</th>
                <th style={{ width: 138 }}>Status</th>
                <th style={{ width: 180 }}>Storyboard</th>
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
                <tr key={shot.id} data-shot-id={shot.id} className={'shot-row' + (selectedShotId === shot.id ? ' is-selected' : '') + (shot.status === 'done' ? ' status-done' : shot.status === 'skip' ? ' status-skip' : '')} onClick={event => { if (!event.target.closest('button')) onSelectedShotIdChange?.(shot.id) }}>
                  <td><div className="shot-num">{shot.num}</div></td>
                  <td>
                    <input className="cell-input" value={shot.subject} onChange={e => updateShot(shot.id, 'subject', e.target.value)} placeholder="Subjek" />
                  </td>
                  <td>
                    <ShotStatusControls shot={shot} onSetStatus={nextStatus => setShotStatus(shot.id, nextStatus)} />
                  </td>
                  <td>
                    <StoryboardControl
                      shot={shot}
                      onUpload={file => handleStoryboardUpload(shot.id, file)}
                      onRemove={() => removeStoryboard(shot.id)}
                      onPreview={() => setPreviewShot(shot)}
                      compact
                    />
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
                          const hasLinkedCamera = (floorplans?.[scene.id]?.cameras || []).some(camera => camera.shotId === shot.id)
                          const message = hasLinkedCamera
                            ? 'Hapus shot ini? Marker kamera akan tetap ada di Floorplan, tetapi tautannya akan dilepas. Tindakan ini tidak dapat dibatalkan.'
                            : 'Hapus shot ini? Tindakan ini tidak dapat dibatalkan.'
                          if (window.confirm(message)) {
                            if (selectedShotId === shot.id) onSelectedShotIdChange?.('')
                            deleteShot(shot.id)
                          }
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
                <td colSpan={17}>
                  <button className="add-shot-btn" onClick={addShot}>
                    <Plus size={13} /> Tambah Shot
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        ) : (
          <div className="storyboard-grid">
            {scene.shots.map(shot => (
              <article key={shot.id} className={'storyboard-card' + (selectedShotId === shot.id ? ' is-selected' : '')}>
                <header className="storyboard-card-header">
                  <button type="button" className="storyboard-card-select" onClick={() => onSelectedShotIdChange?.(shot.id)}>
                    <span className="storyboard-card-number">{shot.num}</span>
                    <span className="storyboard-card-title">{shot.subject || 'Subjek belum diisi'}</span>
                  </button>
                  <ShotStatusControls shot={shot} onSetStatus={nextStatus => setShotStatus(shot.id, nextStatus)} />
                </header>
                <StoryboardControl
                  shot={shot}
                  onUpload={file => handleStoryboardUpload(shot.id, file)}
                  onRemove={() => removeStoryboard(shot.id)}
                  onPreview={() => setPreviewShot(shot)}
                />
                <div className="storyboard-card-details">
                  <span><small>Ukuran</small><strong>{shot.size || '—'}</strong></span>
                  <span><small>Kamera</small><strong>{shot.camera || '—'}</strong></span>
                  <span><small>Lens</small><strong>{shot.lens || '—'}</strong></span>
                  <span><small>Angle</small><strong>{shot.angle || '—'}</strong></span>
                  <span><small>Movement</small><strong>{(shot.movements || []).map(item => item === 'Handheld Movement' ? 'Handheld' : item).join(', ') || '—'}</strong></span>
                </div>
                {shot.notes && <p className="storyboard-card-notes">{shot.notes}</p>}
              </article>
            ))}
            <button type="button" className="storyboard-add-card" onClick={addShot}>
              <Plus size={18} /><span>Tambah shot</span>
            </button>
          </div>
        )}
        {previewShot?.storyboardImage && (
          <div className="storyboard-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewShot(null) }}>
            <section className="storyboard-preview-dialog" role="dialog" aria-modal="true" aria-label={'Storyboard shot ' + previewShot.num}>
              <header>
                <div><span>STORYBOARD · {previewShot.num}</span><h2>{previewShot.subject || 'Subjek belum diisi'}</h2></div>
                <button type="button" className="storyboard-preview-close" onClick={() => setPreviewShot(null)} aria-label="Tutup preview storyboard"><X size={18} /></button>
              </header>
              <img src={previewShot.storyboardImage} alt={'Storyboard shot ' + previewShot.num} />
              <footer><span>Status: {statusLabel(previewShot.status)}</span><button type="button" className="btn btn-secondary" onClick={() => setPreviewShot(null)}><X size={14} /> Tutup preview</button></footer>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function ShotStatusControls({ shot, onSetStatus }) {
  const status = ['done', 'skip'].includes(shot.status) ? shot.status : 'planned'
  return (
    <div className="shot-status-controls" role="group" aria-label={'Status shot ' + shot.num}>
      <button type="button" className={'shot-status-button is-done' + (status === 'done' ? ' active' : '')} aria-pressed={status === 'done'} onClick={() => onSetStatus('done')} title="Tandai shot selesai">
        <Check size={13} /><span>Done</span>
      </button>
      <button type="button" className={'shot-status-button is-skip' + (status === 'skip' ? ' active' : '')} aria-pressed={status === 'skip'} onClick={() => onSetStatus('skip')} title="Tandai shot dilewati">
        <CircleSlash size={13} /><span>Skip</span>
      </button>
    </div>
  )
}

function StoryboardControl({ shot, onUpload, onRemove, onPreview, compact = false }) {
  return (
    <div className={'storyboard-control' + (compact ? ' is-compact' : '')}>
      {shot.storyboardImage ? (
        <button type="button" className="storyboard-thumb-button" onClick={onPreview} title={'Lihat storyboard shot ' + shot.num} aria-label={'Lihat storyboard shot ' + shot.num}>
          <img src={shot.storyboardImage} alt={'Storyboard shot ' + shot.num} loading="lazy" />
        </button>
      ) : (
        <span className="storyboard-empty-thumb" aria-hidden="true"><ImagePlus size={18} /></span>
      )}
      <label className="storyboard-upload-button" title={shot.storyboardImage ? 'Ganti gambar storyboard' : 'Tambah gambar storyboard'}>
        <ImagePlus size={14} /><span>{compact ? (shot.storyboardImage ? 'Ganti' : 'Tambah') : (shot.storyboardImage ? 'Ganti gambar' : 'Tambah gambar')}</span>
        <input type="file" accept="image/*" aria-label={'Unggah storyboard shot ' + shot.num} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(file) }} />
      </label>
      {shot.storyboardImage && <button type="button" className="storyboard-remove-button" onClick={onRemove} title="Hapus gambar storyboard" aria-label={'Hapus storyboard shot ' + shot.num}><X size={13} /></button>}
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
