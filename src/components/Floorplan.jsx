import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Square, Minus, PersonStanding, Camera, Sun, Route,
  Trash2, RotateCw, Plus, Layers2,
} from 'lucide-react'

const MOVEMENTS = [
  'Static', 'Pan', 'Pan Left', 'Pan Right', 'Whip Pan',
  'Tilt Up', 'Tilt Down', 'Dutch Roll', 'Pedestal Up', 'Pedestal Down',
  'Dolly In', 'Dolly Out', 'Truck Left', 'Truck Right', 'Tracking Shot',
  'Follow', 'Lead', 'Arc', 'Orbit', 'Crane Up', 'Crane Down',
  'Jib Up', 'Jib Down', 'Zoom In', 'Zoom Out', 'Dolly Zoom',
  'Push In', 'Pull Out', 'Rack Focus', 'Roll', 'Reveal', 'Reframe',
  'Handheld Movement', 'POV Movement', '360 Orbit', 'Blocking',
]
const ACTOR_MOVEMENTS = [
  'Static', 'Walk', 'Run', 'Enter', 'Exit', 'Cross', 'Sit', 'Stand',
  'Turn', 'Reach', 'Fight', 'Blocking', 'Follow', 'Lead',
]
const LIGHT_MOVEMENTS = ['Static', 'Pan', 'Tilt Up', 'Tilt Down', 'Follow', 'Tracking Shot']
const LIGHT_TYPES = ['Key', 'Fill', 'Back / Rim', 'Practical', 'Ambient', 'Special']
const MAP_WIDTH = 1000
const MAP_HEIGHT = 650
const EMPTY_LAYOUT = { rooms: [], walls: [], actors: [], cameras: [], lights: [] }
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
const makeId = () => crypto.randomUUID()
const padNum = number => String(number).padStart(2, '0')

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
  const selectedMovement = selectedType === 'camera'
    ? (selectedShot?.movements?.includes(selectedEntity?.movement)
      ? selectedEntity.movement
      : selectedShot?.movements?.[0] || 'Static')
    : selectedEntity?.movement || 'Static'

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
    const orphans = layout.cameras.some(camera => camera.shotId && !validShotIds.has(camera.shotId))
    if (orphans) {
      updateLayout(previous => ({
        ...previous,
        cameras: previous.cameras.map(camera => (
          camera.shotId && !validShotIds.has(camera.shotId)
            ? { ...camera, shotId: '' }
            : camera
        )),
      }))
    }
  // Keep the floorplan marker when a linked shot is deleted; it can be linked again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.shots])

  const updateLayout = (updater) => {
    if (!scene) return
    onFloorplansChange(previous => {
      const currentLayout = previous?.[scene.id] || EMPTY_LAYOUT
      return { ...previous, [scene.id]: updater(currentLayout) }
    })
  }

  const getPoint = (event) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * MAP_WIDTH, 0, MAP_WIDTH),
      y: clamp(((event.clientY - rect.top) / rect.height) * MAP_HEIGHT, 0, MAP_HEIGHT),
    }
  }

  const syncShotMovement = (shotId, movement, previousMovement = '') => {
    if (!shotId || !scene) return
    onChange(previous => previous.map(item => item.id !== scene.id ? item : ({
      ...item,
      shots: item.shots.map(shot => {
        if (shot.id !== shotId) return shot
        let movements = Array.isArray(shot.movements) ? [...shot.movements] : []
        if (previousMovement && previousMovement !== movement) {
          movements = movements.filter(value => value !== previousMovement)
        }
        if (movement && !movements.includes(movement)) movements.push(movement)
        return { ...shot, movements }
      }),
    })))
  }

  const placeObject = (type, point) => {
    let item
    if (type === 'camera') {
      let targetShot = scene.shots.find(shot => !layout.cameras.some(camera => camera.shotId === shot.id))
      if (!targetShot) {
        targetShot = defaultShot(scene.shots.length + 1)
        onChange(previous => previous.map(currentScene => currentScene.id !== scene.id ? currentScene : ({
          ...currentScene,
          shots: renumberShots([...currentScene.shots, targetShot]),
        })))
      }
      const movement = targetShot.movements?.[0] || 'Static'
      item = {
        id: makeId(),
        shotId: targetShot.id,
        x: Math.round(point.x),
        y: Math.round(point.y),
        angle: 0,
        label: 'Camera ' + padNum(layout.cameras.length + 1),
        movement,
        path: [],
      }
      updateLayout(previous => ({ ...previous, cameras: [...previous.cameras, item] }))
      syncShotMovement(targetShot.id, movement)
    } else if (type === 'actor') {
      item = {
        id: makeId(),
        x: Math.round(point.x),
        y: Math.round(point.y),
        angle: 0,
        label: 'Actor ' + padNum(layout.actors.length + 1),
        movement: 'Blocking',
        path: [],
      }
      updateLayout(previous => ({ ...previous, actors: [...previous.actors, item] }))
    } else {
      item = {
        id: makeId(),
        x: Math.round(point.x),
        y: Math.round(point.y),
        angle: 0,
        label: 'Light ' + padNum(layout.lights.length + 1),
        lightType: 'Key',
        movement: 'Static',
        path: [],
      }
      updateLayout(previous => ({ ...previous, lights: [...previous.lights, item] }))
    }
    setSelected({ type, id: item.id })
    setTool('select')
  }

  const handleCanvasPointerDown = (event) => {
    const point = getPoint(event)
    if (tool === 'room' || tool === 'wall') {
      svgRef.current?.setPointerCapture?.(event.pointerId)
      setDrawStart(point)
      setPreviewPoint(point)
      return
    }
    if (tool === 'place-actor' || tool === 'place-camera' || tool === 'place-light') {
      const type = tool === 'place-actor' ? 'actor' : tool === 'place-camera' ? 'camera' : 'light'
      placeObject(type, point)
      return
    }
    if (tool === 'path') {
      if (!selectedEntity || !selectedType) {
        setTool('select')
        return
      }
      updateLayout(previous => ({
        ...previous,
        [selectedType + 's']: previous[selectedType + 's'].map(item => item.id !== selectedEntity.id
          ? item
          : { ...item, path: [...(item.path || []), { x: Math.round(point.x), y: Math.round(point.y) }] }),
      }))
      return
    }
    setSelected(null)
  }

  const beginDrag = (type, item, event) => {
    event.stopPropagation()
    if (tool !== 'select') return
    const point = getPoint(event)
    dragRef.current = { type, id: item.id, start: point, original: item }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
  }

  const handleCanvasPointerMove = (event) => {
    const point = getPoint(event)
    if (drawStart) {
      setPreviewPoint(point)
      return
    }
    const drag = dragRef.current
    if (!drag) return
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

  const updateSelected = (patch) => {
    if (!selected || !selectedEntity) return
    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].map(item => item.id === selected.id
        ? { ...item, ...patch }
        : item),
    }))
  }

  const changeMovement = (item, movement) => {
    const previousMovement = selectedType === 'camera' ? selectedMovement : (item.movement || '')
    updateSelected({ movement })
    if (selectedType === 'camera') syncShotMovement(item.shotId, movement, previousMovement)
  }

  const changeCameraLink = (camera, nextShotId) => {
    const anotherCamera = layout.cameras.find(item => item.shotId === nextShotId && item.id !== camera.id)
    if (anotherCamera) {
      window.alert('That shot already has a camera marker. Choose a different shot.')
      return
    }
    const nextShot = scene.shots.find(shot => shot.id === nextShotId)
    if (!nextShot) {
      updateSelected({ shotId: '' })
      return
    }
    const movement = camera.movement || nextShot.movements?.[0] || 'Static'
    updateSelected({ shotId: nextShotId, movement })
    syncShotMovement(nextShotId, movement)
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
    updateLayout(() => ({ rooms: [], walls: [], actors: [], cameras: [], lights: [] }))
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

  const setToolAndSelect = (nextTool) => {
    setTool(nextTool)
    if (nextTool === 'select') setSelected(selected)
  }

  const objectName = (type, item) => {
    if (type === 'camera') {
      const shot = scene.shots.find(entry => entry.id === item.shotId)
      return shot ? ('SHOT ' + shot.num + (shot.subject ? ' · ' + shot.subject : '')) : (item.label || 'Unlinked camera')
    }
    return item.label || (type === 'actor' ? 'Actor' : 'Light')
  }

  const objectColor = type => type === 'camera' ? '#2563eb' : type === 'actor' ? '#8b5cf6' : '#d97706'
  const movementOptions = selectedType === 'actor'
    ? ACTOR_MOVEMENTS
    : selectedType === 'light'
      ? LIGHT_MOVEMENTS
      : MOVEMENTS
  const objectCounts = layout.actors.length + layout.cameras.length + layout.lights.length

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
          <span>{layout.actors.length} Actors</span>
          <span>{layout.cameras.length} Cameras</span>
          <span>{layout.lights.length} Lights</span>
        </div>
      </header>

      <div className="floorplan-main-tools" role="toolbar" aria-label="Floorplan tools">
        <div className="floorplan-tool-group">
          <button className={'floorplan-tool-button' + (tool === 'select' ? ' active' : '')} onClick={() => setToolAndSelect('select')} title="Select and move" aria-label="Select and move" aria-pressed={tool === 'select'}>
            <MousePointer2 size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'room' ? ' active' : '')} onClick={() => setTool('room')} title="Draw room" aria-label="Draw room" aria-pressed={tool === 'room'}>
            <Square size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'wall' ? ' active' : '')} onClick={() => setTool('wall')} title="Draw wall" aria-label="Draw wall" aria-pressed={tool === 'wall'}>
            <Minus size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool('path')} title="Add movement path to selected object" aria-label="Add movement path" aria-pressed={tool === 'path'} disabled={!selectedEntity || selectedType === 'room' || selectedType === 'wall'}>
            <Route size={19} />
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-tool-group">
          <button className={'floorplan-tool-button object-actor' + (tool === 'place-actor' ? ' active' : '')} onClick={() => setTool('place-actor')} title="Place actor" aria-label="Place actor" aria-pressed={tool === 'place-actor'}>
            <PersonStanding size={20} /><span>Actor</span>
          </button>
          <button className={'floorplan-tool-button object-camera' + (tool === 'place-camera' ? ' active' : '')} onClick={() => setTool('place-camera')} title="Place camera" aria-label="Place camera" aria-pressed={tool === 'place-camera'}>
            <Camera size={19} /><span>Camera</span>
          </button>
          <button className={'floorplan-tool-button object-light' + (tool === 'place-light' ? ' active' : '')} onClick={() => setTool('place-light')} title="Place lighting" aria-label="Place lighting" aria-pressed={tool === 'place-light'}>
            <Sun size={19} /><span>Lighting</span>
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
                <marker id="floorplan-arrow-blue" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="#2563eb" />
                </marker>
                <marker id="floorplan-arrow-purple" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="#8b5cf6" />
                </marker>
                <marker id="floorplan-arrow-amber" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="#d97706" />
                </marker>
              </defs>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="var(--bg)" />
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#floorplan-grid-large)" />

              {layout.rooms.map(room => {
                const active = selected?.type === 'room' && selected.id === room.id
                return (
                  <g key={room.id} onPointerDown={event => beginDrag('room', room, event)}>
                    <rect x={room.x} y={room.y} width={room.width} height={room.height}
                      fill={active ? 'rgba(37,99,235,0.08)' : 'rgba(115,115,115,0.06)'}
                      stroke={active ? '#2563eb' : 'var(--text-muted)'}
                      strokeWidth={active ? 3 : 2} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />
                    <text x={room.x + 12} y={room.y + 28} fill="var(--text)" fontSize="18" fontWeight="600" pointerEvents="none">
                      {room.label || 'Room'}
                    </text>
                  </g>
                )
              })}

              {layout.walls.map(wall => (
                <g key={wall.id} onPointerDown={event => beginDrag('wall', wall, event)}>
                  <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke={selected?.type === 'wall' && selected.id === wall.id ? '#2563eb' : 'var(--text)'}
                    strokeWidth={selected?.type === 'wall' && selected.id === wall.id ? 8 : 6}
                    strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                  <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke="transparent" strokeWidth="20" vectorEffect="non-scaling-stroke" />
                </g>
              ))}

              {[...layout.actors.map(item => ({ ...item, _kind: 'actor' })), ...layout.cameras.map(item => ({ ...item, _kind: 'camera' })), ...layout.lights.map(item => ({ ...item, _kind: 'light' }))].map(object => {
                const kind = object._kind
                const color = objectColor(kind)
                const active = selected?.type === kind && selected.id === object.id
                const points = [{ x: object.x, y: object.y }, ...(object.path || [])]
                const pointString = points.map(point => point.x + ',' + point.y).join(' ')
                const markerEnd = kind === 'camera' ? 'url(#floorplan-arrow-blue)' : kind === 'actor' ? 'url(#floorplan-arrow-purple)' : 'url(#floorplan-arrow-amber)'
                return (
                  <g key={kind + '-' + object.id}>
                    {points.length > 1 && (
                      <>
                        <polyline points={pointString} fill="none" stroke={color} strokeWidth="4" strokeDasharray="10 7" opacity=".95" markerEnd={markerEnd} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        {object.path.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="5" fill="var(--bg)" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
                      </>
                    )}
                    <g transform={'translate(' + object.x + ' ' + object.y + ')'} onPointerDown={event => beginDrag(kind, object, event)}>
                      {kind === 'camera' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                          <path d="M0 -18 L52 -34 L52 34 L0 18 Z" fill="rgba(37,99,235,.13)" stroke="#2563eb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                          <rect x="-18" y="-15" width="28" height="30" rx="4" fill="#2563eb" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          <circle cx="-4" cy="0" r="5" fill="white" />
                        </g>
                      )}
                      {kind === 'actor' && (
                        <g pointerEvents="none">
                          <circle cx="0" cy="-10" r="8" fill="#8b5cf6" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          <path d="M0 0V18 M-13 7L0 1L13 7 M0 18L-10 31 M0 18L10 31" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        </g>
                      )}
                      {kind === 'light' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                          <path d="M1 -11 L49 -28 L49 28 L1 11 Z" fill="rgba(245,158,11,.15)" stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                          <circle cx="0" cy="0" r="13" fill="#d97706" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          <circle cx="0" cy="0" r="4" fill="white" />
                        </g>
                      )}
                      {active && <circle cx="0" cy="0" r="31" fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                      <text x="0" y={kind === 'actor' ? 47 : 39} textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
                        {kind === 'camera'
                          ? (scene.shots.find(shot => shot.id === object.shotId)?.num || 'UNLINKED')
                          : object.label}
                      </text>
                    </g>
                  </g>
                )
              })}

              {drawStart && previewPoint && tool === 'room' && (
                <rect
                  x={Math.min(drawStart.x, previewPoint.x)} y={Math.min(drawStart.y, previewPoint.y)}
                  width={Math.abs(previewPoint.x - drawStart.x)} height={Math.abs(previewPoint.y - drawStart.y)}
                  fill="rgba(37,99,235,.06)" stroke="#2563eb" strokeWidth="2" strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke" pointerEvents="none"
                />
              )}
              {drawStart && previewPoint && tool === 'wall' && (
                <line x1={drawStart.x} y1={drawStart.y} x2={previewPoint.x} y2={previewPoint.y}
                  stroke="#2563eb" strokeWidth="3" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )}
            </svg>
          </div>
        </div>

        <aside className="floorplan-inspector">
          {selectedEntity && selectedType ? (
            <>
              <div className="floorplan-inspector-head">
                <span className={'floorplan-type-icon ' + selectedType}>
                  {selectedType === 'actor' ? <PersonStanding size={21} /> : selectedType === 'camera' ? <Camera size={20} /> : selectedType === 'light' ? <Sun size={20} /> : <Square size={20} />}
                </span>
                <div className="floorplan-inspector-title">
                  <strong>{selectedType === 'camera' ? 'Camera' : selectedType === 'actor' ? 'Actor' : selectedType === 'light' ? 'Lighting' : selectedType === 'room' ? 'Room' : 'Wall'}</strong>
                  {selectedType === 'camera' && <span>{selectedShot ? 'Shot ' + selectedShot.num : 'Unlinked'}</span>}
                </div>
                <button className="floorplan-icon-button danger" onClick={deleteSelected} aria-label="Delete selected object" title="Delete selected object"><Trash2 size={17} /></button>
              </div>

              {selectedType === 'camera' && (
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
                  {selectedShot && (
                    <div className="floorplan-link-card">
                      <span>Linked subject</span>
                      <strong>{selectedShot.subject || 'Untitled shot'}</strong>
                      <span>{selectedShot.camera || 'Camera body not set'}</span>
                    </div>
                  )}
                </section>
              )}

              {(selectedType === 'actor' || selectedType === 'light' || selectedType === 'camera') && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="object-label">Name</label>
                  <input id="object-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                </section>
              )}

              {selectedType === 'light' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="light-type">Lighting type</label>
                  <select id="light-type" className="floorplan-field" value={selectedEntity.lightType || 'Key'} onChange={event => updateSelected({ lightType: event.target.value })}>
                    {LIGHT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </section>
              )}

              {(selectedType === 'actor' || selectedType === 'camera' || selectedType === 'light') && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="object-movement">Movement</label>
                    <select id="object-movement" className="floorplan-field" value={selectedMovement} onChange={event => changeMovement(selectedEntity, event.target.value)}>
                      {(selectedType === 'actor' ? ACTOR_MOVEMENTS : selectedType === 'light' ? LIGHT_MOVEMENTS : MOVEMENTS).map(movement => <option key={movement} value={movement}>{movement}</option>)}
                    </select>
                    <button className={'floorplan-path-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')} disabled={selectedType === 'room' || selectedType === 'wall'}>
                      <Route size={17} /> {tool === 'path' ? 'Finish path' : 'Draw movement path'} <span>{(selectedEntity.path || []).length}</span>
                    </button>
                    {(selectedEntity.path || []).length > 0 && (
                      <button className="floorplan-remove-path" onClick={() => updateSelected({ path: [] })}>Remove path</button>
                    )}
                  </section>

                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Position</div>
                    <div className="floorplan-coordinates">
                      <label>X<input type="number" min="0" max={MAP_WIDTH} value={Math.round(selectedEntity.x)} onChange={event => updateSelected({ x: clamp(event.target.value, 0, MAP_WIDTH) })} /></label>
                      <label>Y<input type="number" min="0" max={MAP_HEIGHT} value={Math.round(selectedEntity.y)} onChange={event => updateSelected({ y: clamp(event.target.value, 0, MAP_HEIGHT) })} /></label>
                    </div>
                    <button className="floorplan-rotate-button" onClick={() => updateSelected({ angle: ((selectedEntity.angle || 0) + 15) % 360 })}>
                      <RotateCw size={16} /> Rotate direction 15°
                    </button>
                  </section>
                </>
              )}

              {selectedType === 'room' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="room-label">Room name</label>
                  <input id="room-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  <div className="floorplan-coordinates">
                    <label>X<input type="number" value={selectedEntity.x} onChange={event => updateSelected({ x: clamp(event.target.value, 0, MAP_WIDTH - selectedEntity.width) })} /></label>
                    <label>Y<input type="number" value={selectedEntity.y} onChange={event => updateSelected({ y: clamp(event.target.value, 0, MAP_HEIGHT - selectedEntity.height) })} /></label>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="floorplan-object-browser">
              <div className="floorplan-object-browser-head">
                <strong>Objects</strong><span>{objectCounts}</span>
              </div>
              {allObjects.length === 0 ? (
                <div className="floorplan-empty-state"><Layers2 size={24} /><span>No objects yet</span></div>
              ) : (
                allObjects.map(object => (
                  <button key={object.entityType + object.id} className="floorplan-object-row" onClick={() => setSelected({ type: object.entityType, id: object.id })}>
                    <span className={'floorplan-type-icon ' + object.entityType}>
                      {object.entityType === 'actor' ? <PersonStanding size={18} /> : object.entityType === 'camera' ? <Camera size={18} /> : <Sun size={18} />}
                    </span>
                    <span className="floorplan-object-row-name">{objectName(object.entityType, object)}</span>
                    <span className="floorplan-object-row-type">{object.entityType === 'light' ? 'LIGHT' : object.entityType.toUpperCase()}</span>
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
