import { useState } from 'react'
import { Plus, Pencil, Check, X } from 'lucide-react'

export default function SceneNavigator({
  scenes,
  activeSceneId,
  onActiveSceneChange,
  onAddScene,
  onRenameScene,
  mode = 'compact',
}) {
  const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0]
  const [renamingId, setRenamingId] = useState('')
  const [draft, setDraft] = useState('')

  const startRename = scene => {
    setRenamingId(scene.id)
    setDraft(scene.name || '')
  }

  const finishRename = scene => {
    const nextName = draft.trim()
    if (nextName && nextName !== scene.name) onRenameScene(scene.id, nextName)
    setRenamingId('')
  }

  const cancelRename = scene => {
    setDraft(scene.name || '')
    setRenamingId('')
  }

  const handleRenameKey = (event, scene) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishRename(scene)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename(scene)
    }
  }

  if (mode === 'list') {
    return (
      <aside className="scene-sidebar" aria-label="Navigasi scene">
        <div className="scene-sidebar-header">
          <span>Scene</span>
          <button className="scene-navigator-add" type="button" onClick={onAddScene} title="Tambah scene" aria-label="Tambah scene">
            <Plus size={15} />
          </button>
        </div>
        <div className="scene-navigator-list">
          {scenes.map(scene => {
            const active = scene.id === activeScene?.id
            const renaming = renamingId === scene.id
            return (
              <div key={scene.id} className={'scene-item' + (active ? ' active' : '')}>
                {renaming ? (
                  <input
                    className="scene-navigator-rename-input"
                    value={draft}
                    autoFocus
                    aria-label={'Nama scene ' + (scene.name || '')}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => finishRename(scene)}
                    onKeyDown={event => handleRenameKey(event, scene)}
                  />
                ) : (
                  <button
                    type="button"
                    className="scene-navigator-item-main"
                    onClick={() => onActiveSceneChange(scene.id)}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="scene-item-name">{scene.name}</span>
                    <span className="scene-item-sub">
                      {scene.intExt}{scene.location ? '. ' + scene.location : ''} · {scene.dayNight}
                    </span>
                  </button>
                )}
                {!renaming && (
                  <button
                    type="button"
                    className="scene-navigator-rename"
                    onClick={() => startRename(scene)}
                    title={'Ubah nama ' + scene.name}
                    aria-label={'Ubah nama ' + scene.name}
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <div className="floorplan-scene-control scene-navigator-compact">
      {activeScene && renamingId === activeScene.id ? (
        <>
          <input
            className="scene-navigator-compact-input"
            value={draft}
            autoFocus
            maxLength={120}
            aria-label="Nama scene aktif"
            onChange={event => setDraft(event.target.value)}
            onBlur={() => finishRename(activeScene)}
            onKeyDown={event => handleRenameKey(event, activeScene)}
          />
          <button type="button" className="floorplan-icon-button" onMouseDown={event => event.preventDefault()} onClick={() => finishRename(activeScene)} title="Simpan nama scene" aria-label="Simpan nama scene">
            <Check size={16} />
          </button>
          <button type="button" className="floorplan-icon-button" onMouseDown={event => event.preventDefault()} onClick={() => cancelRename(activeScene)} title="Batal mengubah nama" aria-label="Batal mengubah nama">
            <X size={16} />
          </button>
        </>
      ) : (
        <>
          <select
            className="floorplan-scene-select"
            aria-label="Scene aktif"
            value={activeScene?.id || ''}
            onChange={event => onActiveSceneChange(event.target.value)}
          >
            {scenes.map(scene => (
              <option key={scene.id} value={scene.id}>{scene.name}</option>
            ))}
          </select>
          {activeScene && (
            <button type="button" className="floorplan-icon-button scene-navigator-rename-compact" onClick={() => startRename(activeScene)} title="Ubah nama scene" aria-label="Ubah nama scene">
              <Pencil size={15} />
            </button>
          )}
          <button type="button" className="floorplan-icon-button" onClick={onAddScene} title="Tambah scene" aria-label="Tambah scene">
            <Plus size={18} />
          </button>
        </>
      )}
    </div>
  )
}
