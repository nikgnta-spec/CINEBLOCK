import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Square, Minus, Route, Trash2, Plus, Layers2, X,
} from 'lucide-react'
import {
  SIZES as SHOT_SIZES,
  ANGLES as SHOT_ANGLES,
  LENSES as SHOT_LENSES,
  MOVEMENTS as SHOT_MOVEMENTS,
  EQUIPMENT as SHOT_EQUIPMENT,
} from '../shotOptions'

const LIGHT_TYPES = ['Key', 'Fill', 'Back / Rim', 'Practical', 'Ambient', 'Special']
const CAMERA_PATH_MOVEMENTS = new Set([
  'Dolly In', 'Dolly Out', 'Truck Left', 'Truck Right', 'Tracking Shot',
  'Follow', 'Lead', 'Arc', 'Orbit', 'Crane Up', 'Crane Down',
  'Jib Up', 'Jib Down', 'Push In', 'Pull Out', 'Reveal', 'Reframe',
  'Handheld Movement', 'POV Movement', '360 Orbit', 'Blocking',
])
const MAP_WIDTH = 1000
const MAP_HEIGHT = 650
const EMPTY_LAYOUT = { rooms: [], walls: [], actors: [], cameras: [], lights: [] }
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
const makeId = () => crypto.randomUUID()
const padNum = number => String(number).padStart(2, '0')
const normalizeAngle = angle => ((angle % 360) + 360) % 360

function FloorplanObjectIcon({ type, size = 20 }) {
  if (type === 'light') {
    return <img className="floorplan-lamp-symbol" src="/assets/lamp-icon.png" width={size} height={size} alt="" draggable="false" />
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={type === 'camera' ? '-36 -25 72 50' : '-50 -42 100 84'}
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {type === 'actor' ? (
        <g transform="scale(0.68)">
          <path d="M-22 -6 C-30 -10 -37 -6 -40 2 C-43 12 -36 22 -27 23 C-21 31 -10 34 0 34 C10 34 21 31 27 23 C36 22 43 12 40 2 C37 -6 30 -10 22 -6" />
          <path d="M0 -31 C-17 -31 -22 -17 -21 -6 C-20 5 -15 13 -8 15 C-5 16 -4 20 0 21 C4 20 5 16 8 15 C15 13 20 5 21 -6 C22 -17 17 -31 0 -31 Z" />
          <path d="M-18 0 C-12 -5 -7 6 0 6 C7 6 12 -5 18 0" />
          <path d="M-25 12 C-28 15 -28 19 -25 23 M25 12 C28 15 28 19 25 23" />
        </g>
      ) : (
        <g>
          <path d="M9 -9 L33 -20 L33 20 L9 9 Z" />
          <rect x="-29" y="-15" width="40" height="30" rx="6" />
        </g>
      )}
    </svg>
  )
}

function markerPositionIsClear(position, objects, gapX = 82, gapY = 76) {
  return objects.every(item => Math.abs(item.x - position.x) >= gapX || Math.abs(item.y - position.y) >= gapY)
}

function findAvailablePosition(layout, occupiedOverrides = null) {
  const occupied = occupiedOverrides || [
    ...(layout.actors || []),
    ...(layout.cameras || []),
    ...(layout.lights || []),
  ]
  const centerX = 500
  const centerY = 325
  const stepX = 100
  const stepY = 82

  for (let ring = 0; ring <= 8; ring += 1) {
    for (let row = -ring; row <= ring; row += 1) {
      for (let column = -ring; column <= ring; column += 1) {
        if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue
        const position = { x: centerX + column * stepX, y: centerY + row * stepY }
        if (position.x < 50 || position.x > MAP_WIDTH - 50 || position.y < 46 || position.y > MAP_HEIGHT - 46) continue
        if (markerPositionIsClear(position, occupied)) return position
      }
    }
  }

  return { x: centerX, y: centerY }
}

function renumberShots(shots) {
  return shots.map((shot, index) => ({ ...shot, num: String(index + 1).padStart(3, '0') }))
}

export default function Floorplan({
  scenes,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  defaultShot,
  defaultScene,
  floorplans,
  onFloorplansChange,
}) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const normalizedSceneLayoutsRef = useRef(new Set())
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [drawStart, setDrawStart] = useState(null)
  const [previewPoint, setPreviewPoint] = useState(null)

  const scene = scenes.find(item => item.id === activeSceneId) || scenes[0]
  const layout = scene ? (floorplans?.[scene.id] || EMPTY_LAYOUT) : EMPTY_LAYOUT
  const allObjects = [
    ...layout.actors.map(item => ({ ...item, entityType: 'actor' })),
    ...layout.cameras.map(item => ({ ...item, entityType: 'camera' })),
    ...layout.lights.map(item => ({ ...item, entityType: 'light' })),
  ]
  const selectedEntity = selected
    ? (layout[selected.type + 's'] || []).find(item => item.id === selected.id) || null
    : null
  const selectedType = selectedEntity ? selected.type : null
  const selectedShot = selectedType === 'camera'
    ? scene?.shots.find(shot => shot.id === selectedEntity.shotId) || null
    : null
  const selectedShotMovements = selectedShot?.movements || []
  const selectedCameraCanHavePath = selectedShotMovements.some(movement => CAMERA_PATH_MOVEMENTS.has(movement))
  const selectedCanHavePath = selectedType === 'actor' || (selectedType === 'camera' && selectedCameraCanHavePath)

  useEffect(() => {
    setSelected(null)
    setTool('select')
    setDrawStart(null)
    setPreviewPoint(null)
  }, [scene?.id])

  useEffect(() => {
    if (!scene || !selected) return
    if (!(layout[selected.type + 's'] || []).some(item => item.id === selected.id)) {
      setSelected(null)
      setTool('select')
    }
  }, [scene?.id, layout, selected])

  useEffect(() => {
    if (!scene) return
    const validShotIds = new Set((scene.shots || []).map(shot => shot.id))
    const hasOrphanLinks = layout.cameras.some(camera => camera.shotId && !validShotIds.has(camera.shotId))
    if (hasOrphanLinks) {
      updateLayout(previous => ({
        ...previous,
        cameras: previous.cameras.map(camera => (
          camera.shotId && !validShotIds.has(camera.shotId)
            ? { ...camera, shotId: '' }
            : camera
        )),
      }))
    }
  // Keep the camera marker if its shot is deleted. It can be linked again later.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.shots])

  const updateLayout = updater => {
    if (!scene) return
    onFloorplansChange(previous => {
      const currentLayout = previous?.[scene.id] || EMPTY_LAYOUT
      return { ...previous, [scene.id]: updater(currentLayout) }
    })
  }

  useEffect(() => {
    if (!scene || normalizedSceneLayoutsRef.current.has(scene.id)) return
    normalizedSceneLayoutsRef.current.add(scene.id)

    const ordered = [
      ...layout.actors.map(item => ({ ...item, type: 'actor' })),
      ...layout.cameras.map(item => ({ ...item, type: 'camera' })),
      ...layout.lights.map(item => ({ ...item, type: 'light' })),
    ]
    const accepted = []
    const patches = { actors: {}, cameras: {}, lights: {} }
    let didMove = false

    for (const item of ordered) {
      if (markerPositionIsClear(item, accepted)) {
        accepted.push(item)
        continue
      }
      const currentLayout = {
        actors: accepted.filter(value => value.type === 'actor'),
        cameras: accepted.filter(value => value.type === 'camera'),
        lights: accepted.filter(value => value.type === 'light'),
      }
      const position = findAvailablePosition(currentLayout, accepted)
      const movedItem = { ...item, ...position }
      accepted.push(movedItem)
      patches[item.type + 's'][item.id] = position
      didMove = true
    }

    if (didMove) {
      updateLayout(previous => ({
        ...previous,
        actors: previous.actors.map(item => patches.actors[item.id] ? { ...item, ...patches.actors[item.id] } : item),
        cameras: previous.cameras.map(item => patches.cameras[item.id] ? { ...item, ...patches.cameras[item.id] } : item),
        lights: previous.lights.map(item => patches.lights[item.id] ? { ...item, ...patches.lights[item.id] } : item),
      }))
    }
  // One-time repair of obvious old auto-placement collisions when entering a scene.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, layout])

  const getPoint = event => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * MAP_WIDTH, 0, MAP_WIDTH),
      y: clamp(((event.clientY - rect.top) / rect.height) * MAP_HEIGHT, 0, MAP_HEIGHT),
    }
  }

  // Object buttons create an object immediately. The new marker is selected and
  // can be dragged straight to its final position without another placement click.
  const addObject = type => {
    const count = type === 'actor' ? layout.actors.length : type === 'camera' ? layout.cameras.length : layout.lights.length
    const position = findAvailablePosition(layout)
    let object

    if (type === 'actor') {
      object = {
        id: makeId(),
        ...position,
        angle: 0,
        label: 'Actor ' + padNum(count + 1),
        path: [],
      }
      updateLayout(previous => ({ ...previous, actors: [...previous.actors, object] }))
    } else if (type === 'light') {
      object = {
        id: makeId(),
        ...position,
        angle: 0,
        lightType: 'Key',
      }
      updateLayout(previous => ({ ...previous, lights: [...previous.lights, object] }))
    } else {
      const linkedShotIds = new Set(layout.cameras.map(camera => camera.shotId).filter(Boolean))
      let targetShot = scene.shots.find(shot => !linkedShotIds.has(shot.id))
      if (!targetShot) {
        targetShot = defaultShot(scene.shots.length + 1)
        onChange(previous => previous.map(currentScene => currentScene.id !== scene.id ? currentScene : ({
          ...currentScene,
          shots: renumberShots([...currentScene.shots, targetShot]),
        })))
      }
      object = {
        id: makeId(),
        ...position,
        angle: 0,
        shotId: targetShot.id,
        path: [],
      }
      updateLayout(previous => ({ ...previous, cameras: [...previous.cameras, object] }))
    }

    setSelected({ type, id: object.id })
    setTool('select')
  }

  const beginObjectDrag = (type, item, event) => {
    event.stopPropagation()
    if (tool === 'room' || tool === 'wall') return
    const point = getPoint(event)
    dragRef.current = { mode: 'move', type, id: item.id, start: point, original: item }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
  }

  const beginRotate = (type, item, event) => {
    event.stopPropagation()
    const point = getPoint(event)
    dragRef.current = {
      mode: 'rotate',
      type,
      id: item.id,
      center: { x: item.x, y: item.y },
      initialAngle: Number(item.angle) || 0,
      startPointerAngle: Math.atan2(point.y - item.y, point.x - item.x) * 180 / Math.PI,
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
  }

  const updateLinkedShot = (key, value) => {
    if (!scene || selectedType !== 'camera' || !selectedEntity?.shotId) return
    const sceneId = scene.id
    const shotId = selectedEntity.shotId
    onChange(previous => previous.map(currentScene => currentScene.id !== sceneId
      ? currentScene
      : {
        ...currentScene,
        shots: currentScene.shots.map(shot => shot.id === shotId
          ? { ...shot, [key]: value }
          : shot),
      }))
  }

  const addShotListItem = (key, value) => {
    if (!value || !selectedShot) return
    const current = Array.isArray(selectedShot[key]) ? selectedShot[key] : []
    if (!current.includes(value)) updateLinkedShot(key, [...current, value])
  }

  const removeShotListItem = (key, value) => {
    if (!selectedShot) return
    const current = Array.isArray(selectedShot[key]) ? selectedShot[key] : []
    updateLinkedShot(key, current.filter(item => item !== value))
  }

  useEffect(() => {
    if (tool === 'path' && !selectedCanHavePath) setTool('select')
  }, [tool, selectedCanHavePath])

  const appendWaypoint = point => {
    if (!selectedEntity || !selectedType || (selectedType === 'camera' && !selectedCameraCanHavePath) || selectedType === 'light' || selectedType === 'room' || selectedType === 'wall') return
    updateLayout(previous => ({
      ...previous,
      [selectedType + 's']: previous[selectedType + 's'].map(item => item.id !== selectedEntity.id
        ? item
        : { ...item, path: [...(item.path || []), { x: Math.round(point.x), y: Math.round(point.y) }] }),
    }))
  }

  const handleCanvasPointerDown = event => {
    const point = getPoint(event)
    if (tool === 'room' || tool === 'wall') {
      svgRef.current?.setPointerCapture?.(event.pointerId)
      setDrawStart(point)
      setPreviewPoint(point)
      return
    }
    if (tool === 'path') {
      appendWaypoint(point)
      return
    }
    if (tool === 'select') setSelected(null)
  }

  const handleCanvasPointerMove = event => {
    const point = getPoint(event)
    if (drawStart) {
      setPreviewPoint(point)
      return
    }
    const drag = dragRef.current
    if (!drag) return

    if (drag.mode === 'rotate') {
      const pointerAngle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180 / Math.PI
      const nextAngle = normalizeAngle(drag.initialAngle + pointerAngle - drag.startPointerAngle)
      updateLayout(previous => ({
        ...previous,
        [drag.type + 's']: previous[drag.type + 's'].map(item => (
          item.id === drag.id ? { ...item, angle: nextAngle } : item
        )),
      }))
      return
    }

    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    updateLayout(previous => ({
      ...previous,
      [drag.type + 's']: previous[drag.type + 's'].map(item => {
        if (item.id !== drag.id) return item
        if (drag.type === 'actor' || drag.type === 'camera' || drag.type === 'light') {
          return {
            ...item,
            x: Math.round(clamp(drag.original.x + dx, 0, MAP_WIDTH)),
            y: Math.round(clamp(drag.original.y + dy, 0, MAP_HEIGHT)),
          }
        }
        if (drag.type === 'room') {
          return {
            ...item,
            x: Math.round(clamp(drag.original.x + dx, 0, MAP_WIDTH - item.width)),
            y: Math.round(clamp(drag.original.y + dy, 0, MAP_HEIGHT - item.height)),
          }
        }
        if (drag.type === 'wall') {
          return {
            ...item,
            x1: Math.round(clamp(drag.original.x1 + dx, 0, MAP_WIDTH)),
            y1: Math.round(clamp(drag.original.y1 + dy, 0, MAP_HEIGHT)),
            x2: Math.round(clamp(drag.original.x2 + dx, 0, MAP_WIDTH)),
            y2: Math.round(clamp(drag.original.y2 + dy, 0, MAP_HEIGHT)),
          }
        }
        return item
      }),
    }))
  }

  const handleCanvasPointerUp = () => {
    if (drawStart && previewPoint) {
      const width = Math.abs(previewPoint.x - drawStart.x)
      const height = Math.abs(previewPoint.y - drawStart.y)
      if (tool === 'room' && width >= 12 && height >= 12) {
        const room = {
          id: makeId(),
          x: Math.round(Math.min(drawStart.x, previewPoint.x)),
          y: Math.round(Math.min(drawStart.y, previewPoint.y)),
          width: Math.round(width),
          height: Math.round(height),
          label: 'Room ' + padNum(layout.rooms.length + 1),
        }
        updateLayout(previous => ({ ...previous, rooms: [...previous.rooms, room] }))
        setSelected({ type: 'room', id: room.id })
        setTool('select')
      } else if (tool === 'wall' && Math.hypot(width, height) >= 8) {
        const wall = {
          id: makeId(),
          x1: Math.round(drawStart.x), y1: Math.round(drawStart.y),
          x2: Math.round(previewPoint.x), y2: Math.round(previewPoint.y),
        }
        updateLayout(previous => ({ ...previous, walls: [...previous.walls, wall] }))
        setSelected({ type: 'wall', id: wall.id })
        setTool('select')
      }
    }
    setDrawStart(null)
    setPreviewPoint(null)
    dragRef.current = null
  }

  const updateSelected = patch => {
    if (!selected || !selectedEntity) return
    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].map(item => (
        item.id === selected.id ? { ...item, ...patch } : item
      )),
    }))
  }

  const changeCameraLink = (camera, nextShotId) => {
    const anotherCamera = layout.cameras.find(item => item.shotId === nextShotId && item.id !== camera.id)
    if (nextShotId && anotherCamera) {
      window.alert('That shot already has a camera marker. Choose a different shot.')
      return
    }
    updateSelected({ shotId: nextShotId })
  }

  const deleteSelected = () => {
    if (!selected) return
    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].filter(item => item.id !== selected.id),
    }))
    setSelected(null)
    setTool('select')
  }

  const clearLayout = () => {
    if (!window.confirm('Clear this scene’s floorplan, actors, cameras and lighting?')) return
    updateLayout(() => ({ ...EMPTY_LAYOUT }))
    setSelected(null)
    setTool('select')
  }

  const addScene = () => {
    const newScene = defaultScene(scenes.length + 1)
    onChange(previous => [...previous, newScene])
    onActiveSceneChange(newScene.id)
    setSelected(null)
    setTool('select')
  }

  const objectName = (type, item) => {
    if (type === 'camera') {
      const shot = scene.shots.find(entry => entry.id === item.shotId)
      return shot ? ('Shot ' + shot.num + (shot.subject ? ' — ' + shot.subject : '')) : 'Unlinked camera'
    }
    if (type === 'light') return item.lightType || 'Key'
    return item.label || 'Actor'
  }

  const objectTypeLabel = type => type === 'actor' ? 'Actor' : type === 'camera' ? 'Camera' : type === 'light' ? 'Lighting' : type === 'room' ? 'Room' : 'Wall'
  const objectCount = layout.actors.length + layout.cameras.length + layout.lights.length
  const selectedPath = selectedEntity?.path || []
  if (!scene) return null

  return (
    <div className="floorplan-workspace">
      <header className="floorplan-top">
        <div className="floorplan-scene-control">
          <select
            className="floorplan-scene-select"
            aria-label="Current scene"
            value={scene.id}
            onChange={event => onActiveSceneChange(event.target.value)}
          >
            {scenes.map((item, index) => (
              <option key={item.id} value={item.id}>
                {item.name || ('Scene ' + padNum(index + 1))}
              </option>
            ))}
          </select>
          <button className="floorplan-icon-button" onClick={addScene} title="Add scene" aria-label="Add scene">
            <Plus size={18} />
          </button>
        </div>
        <div className="floorplan-top-meta">
          <span>{layout.actors.length} Actor{layout.actors.length === 1 ? '' : 's'}</span>
          <span>{layout.cameras.length} Camera{layout.cameras.length === 1 ? '' : 's'}</span>
          <span>{layout.lights.length} Lighting</span>
        </div>
      </header>

      <div className="floorplan-main-tools" role="toolbar" aria-label="Floorplan tools">
        <div className="floorplan-tool-group">
          <button className={'floorplan-tool-button' + (tool === 'select' ? ' active' : '')} onClick={() => setTool('select')} title="Select and move" aria-label="Select and move" aria-pressed={tool === 'select'}>
            <MousePointer2 size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'room' ? ' active' : '')} onClick={() => setTool('room')} title="Draw room" aria-label="Draw room" aria-pressed={tool === 'room'}>
            <Square size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'wall' ? ' active' : '')} onClick={() => setTool('wall')} title="Draw wall" aria-label="Draw wall" aria-pressed={tool === 'wall'}>
            <Minus size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')} title="Draw path for selected actor or camera" aria-label="Draw movement path" aria-pressed={tool === 'path'} disabled={!selectedCanHavePath}>
            <Route size={19} />
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-tool-group">
          <button className="floorplan-tool-button" onClick={() => addObject('actor')} title="Add actor" aria-label="Add actor">
            <FloorplanObjectIcon type="actor" size={22} /><span>Actor</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('camera')} title="Add camera and link a shot" aria-label="Add camera">
            <FloorplanObjectIcon type="camera" size={22} /><span>Camera</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('light')} title="Add lighting" aria-label="Add lighting">
            <FloorplanObjectIcon type="light" size={22} /><span>Lighting</span>
          </button>
        </div>
        <span className="floorplan-tool-spacer" />
        <button className="floorplan-icon-button floorplan-clear-button" onClick={clearLayout} title="Clear current scene" aria-label="Clear current scene">
          <Trash2 size={17} />
        </button>
      </div>

      <div className="floorplan-editor">
        <div className="floorplan-canvas-column">
          <div className="floorplan-canvas-frame">
            <svg
              ref={svgRef}
              className={'floorplan-canvas' + (tool === 'select' ? ' can-select' : ' can-draw')}
              viewBox={'0 0 ' + MAP_WIDTH + ' ' + MAP_HEIGHT}
              preserveAspectRatio="none"
              role="img"
              aria-label="Top-down floorplan canvas"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            >
              <defs>
                <pattern id="floorplan-grid-small" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M25 0H0V25" fill="none" stroke="var(--border)" strokeWidth="1" />
                </pattern>
                <pattern id="floorplan-grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
                  <rect width="100" height="100" fill="url(#floorplan-grid-small)" />
                  <path d="M100 0H0V100" fill="none" stroke="var(--border-strong)" strokeWidth="1.2" />
                </pattern>
                <marker id="floorplan-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="var(--text-muted)" />
                </marker>
              </defs>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="var(--bg)" />
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#floorplan-grid-large)" />

              {layout.rooms.map(room => (
                <g key={room.id} onPointerDown={event => beginObjectDrag('room', room, event)}>
                  <rect
                    x={room.x} y={room.y} width={room.width} height={room.height}
                    fill={selected?.type === 'room' && selected.id === room.id ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
                    stroke={selected?.type === 'room' && selected.id === room.id ? 'var(--text)' : 'var(--border-strong)'}
                    strokeWidth={selected?.type === 'room' && selected.id === room.id ? 3 : 2}
                    strokeDasharray="7 4" vectorEffect="non-scaling-stroke"
                  />
                  <text x={room.x + 12} y={room.y + 28} fill="var(--text)" fontSize="18" fontWeight="600" pointerEvents="none">
                    {room.label || 'Room'}
                  </text>
                </g>
              ))}

              {layout.walls.map(wall => (
                <g key={wall.id} onPointerDown={event => beginObjectDrag('wall', wall, event)}>
                  <line
                    x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke={selected?.type === 'wall' && selected.id === wall.id ? 'var(--text)' : 'var(--border-strong)'}
                    strokeWidth={selected?.type === 'wall' && selected.id === wall.id ? 8 : 6}
                    strokeLinecap="square" vectorEffect="non-scaling-stroke"
                  />
                  <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke="transparent" strokeWidth="20" vectorEffect="non-scaling-stroke" />
                </g>
              ))}

              {[
                ...layout.actors.map(item => ({ ...item, _kind: 'actor' })),
                ...layout.cameras.map(item => ({ ...item, _kind: 'camera' })),
                ...layout.lights.map(item => ({ ...item, _kind: 'light' })),
              ].map(object => {
                const type = object._kind
                const active = selected?.type === type && selected.id === object.id
                const shot = type === 'camera' ? scene.shots.find(item => item.id === object.shotId) : null
                const shotMovements = shot?.movements || []
                const cameraCanHavePath = type === 'camera' && shotMovements.some(movement => CAMERA_PATH_MOVEMENTS.has(movement))
                const showPath = type === 'actor' || cameraCanHavePath
                const panLeft = type === 'camera' && shotMovements.includes('Pan Left')
                const panRight = type === 'camera' && shotMovements.includes('Pan Right')
                const panBoth = type === 'camera' && shotMovements.includes('Pan') && !panLeft && !panRight
                const points = [
                  { x: object.x, y: object.y },
                  ...(showPath ? (object.path || []) : []),
                ]
                const pointString = points.map(point => point.x + ',' + point.y).join(' ')
                const handleBaseAngle = type === 'actor' ? -90 : type === 'light' ? 90 : 0
                const handleRadians = (handleBaseAngle + (object.angle || 0)) * Math.PI / 180
                const handlePoint = {
                  x: object.x + Math.cos(handleRadians) * 44,
                  y: object.y + Math.sin(handleRadians) * 44,
                }
                return (
                  <g key={type + '-' + object.id}>
                    {points.length > 1 && (
                      <polyline points={pointString} fill="none" stroke={active ? 'var(--text)' : 'var(--text-muted)'} strokeOpacity={active ? 0.95 : 0.3} strokeWidth={active ? 3 : 2} strokeDasharray={active ? '9 6' : '5 9'} markerEnd="url(#floorplan-arrow)" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    )}
                    {(showPath ? (object.path || []) : []).map((point, index) => (
                      <circle key={index} cx={point.x} cy={point.y} r={active ? 5 : 3} fill="var(--bg)" stroke={active ? 'var(--text)' : 'var(--text-muted)'} strokeOpacity={active ? 1 : 0.3} strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    ))}
                    <g
                      transform={'translate(' + object.x + ' ' + object.y + ')'}
                      onPointerDown={event => beginObjectDrag(type, object, event)}
                      style={{ cursor: 'grab' }}
                    >
                      <rect
                        x={type === 'actor' ? -36 : type === 'camera' ? -36 : -25}
                        y={type === 'actor' ? -30 : type === 'camera' ? -25 : -24}
                        width={type === 'actor' ? 72 : type === 'camera' ? 74 : 50}
                        height={type === 'actor' ? 80 : type === 'camera' ? 78 : 62}
                        fill="transparent"
                        pointerEvents="all"
                      />
                      {type === 'camera' && (
                        <g transform={'rotate(' + (object.angle || 0) + ') scale(0.78)'} pointerEvents="none">
                          <path d="M9 -9 L33 -20 L33 20 L9 9 Z" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                          <rect x="-29" y="-15" width="40" height="30" rx="6" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                        </g>
                      )}
                      {type === 'camera' && (panLeft || panRight || panBoth) && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} stroke="var(--text-muted)" strokeWidth="2.5" fill="none" pointerEvents="none">
                          {panBoth || (panLeft && panRight) ? (
                            <line x1="-38" y1="-26" x2="38" y2="-26" markerStart="url(#floorplan-arrow)" markerEnd="url(#floorplan-arrow)" />
                          ) : panLeft ? (
                            <line x1="-4" y1="-26" x2="-42" y2="-26" markerEnd="url(#floorplan-arrow)" />
                          ) : (
                            <line x1="4" y1="-26" x2="42" y2="-26" markerEnd="url(#floorplan-arrow)" />
                          )}
                        </g>
                      )}
                      {type === 'actor' && (
                        <g transform={'rotate(' + (object.angle || 0) + ') scale(0.68)'} pointerEvents="none">
                          <g fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                            <path d="M-22 -6 C-30 -10 -37 -6 -40 2 C-43 12 -36 22 -27 23 C-21 31 -10 34 0 34 C10 34 21 31 27 23 C36 22 43 12 40 2 C37 -6 30 -10 22 -6" />
                            <path d="M0 -31 C-17 -31 -22 -17 -21 -6 C-20 5 -15 13 -8 15 C-5 16 -4 20 0 21 C4 20 5 16 8 15 C15 13 20 5 21 -6 C22 -17 17 -31 0 -31 Z" />
                            <path d="M-18 0 C-12 -5 -7 6 0 6 C7 6 12 -5 18 0" />
                            <path d="M-25 12 C-28 15 -28 19 -25 23 M25 12 C28 15 28 19 25 23" />
                          </g>
                        </g>
                      )}
                      {type === 'actor' && (
                        <text
                          x="0"
                          y="40"
                          textAnchor="middle"
                          fontSize="15"
                          fontWeight="500"
                          fill="var(--text)"
                          stroke="var(--bg)"
                          strokeWidth="4"
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {object.label || 'Actor'}
                        </text>
                      )}
                      {type === 'light' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                          <image className="floorplan-lamp-symbol" href="/assets/lamp-icon.png" x="-19" y="-19" width="38" height="38" preserveAspectRatio="xMidYMid meet" />
                        </g>
                      )}
                      {active && <circle cx="0" cy="0" r="34" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                      {type === 'camera' && (
                        <text x="0" y="46" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
                          {shot ? shot.num : '—'}
                        </text>
                      )}
                      {type === 'light' && (
                        <text x="0" y="35" textAnchor="middle" fontSize="13" fontWeight="500" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
                          {object.lightType || 'Key'}
                        </text>
                      )}
                    </g>

                    {active && (
                      <g onPointerDown={event => beginRotate(type, object, event)} style={{ cursor: 'grab' }}>
                        <line x1={object.x} y1={object.y} x2={handlePoint.x} y2={handlePoint.y} stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        <circle cx={handlePoint.x} cy={handlePoint.y} r="12" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <circle cx={handlePoint.x} cy={handlePoint.y} r="3" fill="var(--text)" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      </g>
                    )}
                  </g>
                )
              })}

              {drawStart && previewPoint && tool === 'room' && (
                <rect
                  x={Math.min(drawStart.x, previewPoint.x)} y={Math.min(drawStart.y, previewPoint.y)}
                  width={Math.abs(previewPoint.x - drawStart.x)} height={Math.abs(previewPoint.y - drawStart.y)}
                  fill="var(--bg-hover)" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke" pointerEvents="none"
                />
              )}
              {drawStart && previewPoint && tool === 'wall' && (
                <line x1={drawStart.x} y1={drawStart.y} x2={previewPoint.x} y2={previewPoint.y}
                  stroke="var(--text)" strokeWidth="3" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )}
            </svg>
          </div>
        </div>

        <aside className="floorplan-inspector">
          {selectedEntity && selectedType ? (
            <>
              <div className="floorplan-inspector-head">
                <span className={'floorplan-type-icon ' + selectedType}>
                  {selectedType === 'actor' || selectedType === 'camera' || selectedType === 'light'
                    ? <FloorplanObjectIcon type={selectedType} size={25} />
                    : <Square size={20} />}
                </span>
                <div className="floorplan-inspector-title">
                  <strong>{objectTypeLabel(selectedType)}</strong>
                  {selectedType === 'camera' && <span>{selectedShot ? 'Shot ' + selectedShot.num : 'Unlinked'}</span>}
                </div>
                <button className="floorplan-icon-button danger" onClick={deleteSelected} aria-label="Delete selected object" title="Delete selected object"><Trash2 size={17} /></button>
              </div>

              {selectedType === 'actor' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="actor-name">Actor</label>
                    <input id="actor-name" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Path</div>
                    <button className={'floorplan-path-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')}>
                      <Route size={17} /> {tool === 'path' ? 'Finish path' : 'Draw path'} <span>{selectedPath.length}</span>
                    </button>
                    {selectedPath.length > 0 && (
                      <button className="floorplan-remove-path" onClick={() => updateSelected({ path: [] })}>Remove path</button>
                    )}
                  </section>
                </>
              )}

              {selectedType === 'camera' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="camera-linked-shot">Shot List link</label>
                    <select
                      id="camera-linked-shot"
                      className="floorplan-field"
                      value={selectedEntity.shotId || ''}
                      onChange={event => changeCameraLink(selectedEntity, event.target.value)}
                    >
                      <option value="">Unlinked</option>
                      {scene.shots.filter(shot => !layout.cameras.some(camera => camera.id !== selectedEntity.id && camera.shotId === shot.id)).map(shot => (
                        <option key={shot.id} value={shot.id}>{shot.num} — {shot.subject || 'Untitled shot'}</option>
                      ))}
                    </select>
                  </section>
                  {selectedShot ? (
                    <>
                      <section className="floorplan-inspector-section floorplan-camera-fields">
                        <label htmlFor="camera-subject">Subject</label>
                        <input
                          id="camera-subject"
                          className="floorplan-field"
                          value={selectedShot.subject || ''}
                          maxLength={1000}
                          onChange={event => updateLinkedShot('subject', event.target.value)}
                          placeholder="Shot subject"
                        />
                        <label htmlFor="camera-body">Camera</label>
                        <input
                          id="camera-body"
                          className="floorplan-field"
                          value={selectedShot.camera || ''}
                          maxLength={200}
                          onChange={event => updateLinkedShot('camera', event.target.value)}
                          placeholder="Camera body"
                        />
                        <label htmlFor="camera-shot-size">Shot size</label>
                        <select
                          id="camera-shot-size"
                          className="floorplan-field"
                          value={selectedShot.size || ''}
                          onChange={event => updateLinkedShot('size', event.target.value)}
                        >
                          <option value="">Select shot size</option>
                          {SHOT_SIZES.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <label htmlFor="camera-angle">Angle</label>
                        <select
                          id="camera-angle"
                          className="floorplan-field"
                          value={selectedShot.angle || ''}
                          onChange={event => updateLinkedShot('angle', event.target.value)}
                        >
                          <option value="">Select angle</option>
                          {SHOT_ANGLES.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <label htmlFor="camera-lens">Lens</label>
                        <input
                          id="camera-lens"
                          className="floorplan-field"
                          list="floorplan-lens-options"
                          value={selectedShot.lens || ''}
                          maxLength={100}
                          onChange={event => updateLinkedShot('lens', event.target.value)}
                          placeholder="Choose or type focal length"
                        />
                        <datalist id="floorplan-lens-options">
                          {SHOT_LENSES.map(option => <option key={option} value={option} />)}
                        </datalist>
                      </section>

                      <section className="floorplan-inspector-section">
                        <label>Movement</label>
                        <div className="floorplan-shot-chips">
                          {(selectedShot.movements || []).map(movement => (
                            <span className="floorplan-shot-chip" key={movement}>
                              {movement}
                              <button type="button" title={'Remove ' + movement} aria-label={'Remove movement ' + movement} onClick={() => removeShotListItem('movements', movement)}>
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <select
                          className="floorplan-field"
                          aria-label="Add camera movement"
                          value=""
                          onChange={event => addShotListItem('movements', event.target.value)}
                        >
                          <option value="">+ Add movement</option>
                          {SHOT_MOVEMENTS.filter(movement => !(selectedShot.movements || []).includes(movement)).map(movement => (
                            <option key={movement} value={movement}>{movement}</option>
                          ))}
                        </select>
                        {(selectedShot.movements || []).some(movement => movement === 'Pan Left' || movement === 'Pan Right' || movement === 'Pan') && (
                          <p className="floorplan-field-note">
                            {selectedShot.movements.includes('Pan Left') && selectedShot.movements.includes('Pan Right')
                              ? 'Pan arrows show both directions on the canvas.'
                              : selectedShot.movements.includes('Pan Left')
                                ? 'Arrow points left.'
                                : selectedShot.movements.includes('Pan Right')
                                  ? 'Arrow points right.'
                                  : 'Pan is shown with a two-way arrow.'}
                          </p>
                        )}
                      </section>

                      <section className="floorplan-inspector-section">
                        <label>Equipment</label>
                        <div className="floorplan-shot-chips">
                          {(selectedShot.equipment || []).map(item => (
                            <span className="floorplan-shot-chip" key={item}>
                              {item}
                              <button type="button" title={'Remove ' + item} aria-label={'Remove equipment ' + item} onClick={() => removeShotListItem('equipment', item)}>
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <select
                          className="floorplan-field"
                          aria-label="Add camera equipment"
                          value=""
                          onChange={event => addShotListItem('equipment', event.target.value)}
                        >
                          <option value="">+ Add equipment</option>
                          {SHOT_EQUIPMENT.filter(item => !(selectedShot.equipment || []).includes(item)).map(item => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </section>

                      {selectedCameraCanHavePath && (
                        <section className="floorplan-inspector-section">
                          <label>Movement path (optional)</label>
                          <button className={'floorplan-path-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')}>
                            <Route size={17} /> {tool === 'path' ? 'Finish path' : 'Draw path'} <span>{selectedPath.length}</span>
                          </button>
                          {selectedPath.length > 0 && (
                            <button className="floorplan-remove-path" onClick={() => updateSelected({ path: [] })}>Remove path</button>
                          )}
                        </section>
                      )}
                    </>
                  ) : (
                    <div className="floorplan-inspector-section floorplan-unlinked">
                      <strong>Camera belum ditautkan ke shot.</strong>
                      <span>Pilih shot di atas untuk mengedit data bersama dengan Shot List.</span>
                    </div>
                  )}
                </>
              )}{selectedType === 'light' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="light-type">Lighting type</label>
                  <select id="light-type" className="floorplan-field" value={selectedEntity.lightType || 'Key'} onChange={event => updateSelected({ lightType: event.target.value })}>
                    {LIGHT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </section>
              )}

              {selectedType === 'room' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="room-label">Room name</label>
                  <input id="room-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                </section>
              )}
            </>
          ) : (
            <div className="floorplan-object-browser">
              <div className="floorplan-object-browser-head">
                <strong>Objects</strong><span>{objectCount}</span>
              </div>
              {allObjects.length === 0 ? (
                <div className="floorplan-empty-state"><Layers2 size={24} /><span>No objects yet</span></div>
              ) : (
                allObjects.map(object => (
                  <button key={object.entityType + object.id} className="floorplan-object-row" onClick={() => setSelected({ type: object.entityType, id: object.id })}>
                    <span className={'floorplan-type-icon ' + object.entityType}>
                      <FloorplanObjectIcon type={object.entityType} size={22} />
                    </span>
                    <span className="floorplan-object-row-name">{objectName(object.entityType, object)}</span>
                    <span className="floorplan-object-row-type">{objectTypeLabel(object.entityType)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
