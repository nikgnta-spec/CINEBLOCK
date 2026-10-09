import { useEffect, useRef, useState } from 'react'
import {
  Camera, Sun, Square, Minus, MousePointer2, Route, Trash2,
  RotateCw, Grid2X2, MapPin,
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
const LIGHT_TYPES = ['Key', 'Fill', 'Back / Rim', 'Practical', 'Ambient', 'Special']
const MAP_WIDTH = 1000
const MAP_HEIGHT = 650
const EMPTY_LAYOUT = { rooms: [], walls: [], cameras: [], lights: [] }

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
const makeId = () => crypto.randomUUID()

export default function Floorplan({
  scenes,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  floorplans,
  onFloorplansChange,
}) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [selectedShotId, setSelectedShotId] = useState('')
  const [drawStart, setDrawStart] = useState(null)
  const [previewPoint, setPreviewPoint] = useState(null)

  const activeIndex = Math.max(0, scenes.findIndex(scene => scene.id === activeSceneId))
  const scene = scenes[activeIndex]
  const layout = scene ? (floorplans?.[scene.id] || EMPTY_LAYOUT) : EMPTY_LAYOUT
  const shots = scene?.shots || []
  const selectedShot = shots.find(shot => shot.id === selectedShotId) || shots[0] || null
  const selectedEntity = selected
    ? (layout[selected.type + 's'] || []).find(item => item.id === selected.id) || null
    : null

  useEffect(() => {
    if (!scene) return
    setSelectedShotId(previous => shots.some(shot => shot.id === previous) ? previous : (shots[0]?.id || ''))
  }, [scene?.id, shots])

  useEffect(() => {
    if (!scene || !selected) return
    if (!(layout[selected.type + 's'] || []).some(item => item.id === selected.id)) {
      setSelected(null)
    }
  }, [scene?.id, layout, selected])

  useEffect(() => {
    if (!scene) return
    const validShotIds = new Set(shots.map(shot => shot.id))
    const hasOrphans = layout.cameras.some(camera => !validShotIds.has(camera.shotId))
    if (hasOrphans) {
      updateLayout(previous => ({
        ...previous,
        cameras: previous.cameras.filter(camera => validShotIds.has(camera.shotId)),
      }))
    }
  // The canvas is only mounted after project hydration; this also cleans placements
  // when a shot is deleted from Shot List.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, shots])

  const updateLayout = (updater) => {
    if (!scene) return
    onFloorplansChange(previous => {
      const current = previous?.[scene.id] || EMPTY_LAYOUT
      return { ...previous, [scene.id]: updater(current) }
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

  const syncShotMovement = (shotId, movement, previousMovement) => {
    onChange(previous => previous.map(item => item.id !== scene.id ? item : ({
      ...item,
      shots: item.shots.map(shot => {
        if (shot.id !== shotId) return shot
        let movements = Array.isArray(shot.movements) ? [...shot.movements] : []
        if (previousMovement && previousMovement !== movement) {
          movements = movements.filter(item => item !== previousMovement)
        }
        if (movement && !movements.includes(movement)) movements.push(movement)
        return { ...shot, movements }
      }),
    })))
  }

  const addCameraAt = (point) => {
    if (!selectedShot) {
      window.alert('Add a shot in Shot List before placing a camera.')
      setTool('select')
      return
    }
    const existing = layout.cameras.find(camera => camera.shotId === selectedShot.id)
    if (existing) {
      setSelected({ type: 'camera', id: existing.id })
      setTool('select')
      return
    }

    const movement = selectedShot.movements?.[0] || 'Static'
    const camera = {
      id: makeId(),
      shotId: selectedShot.id,
      x: Math.round(point.x),
      y: Math.round(point.y),
      angle: 0,
      movement,
      path: [],
    }
    updateLayout(previous => ({ ...previous, cameras: [...previous.cameras, camera] }))
    setSelected({ type: 'camera', id: camera.id })
    setTool('select')
    if (movement && movement !== 'Static') syncShotMovement(selectedShot.id, movement, '')
  }

  const addLightAt = (point) => {
    const light = {
      id: makeId(),
      x: Math.round(point.x),
      y: Math.round(point.y),
      angle: 0,
      type: 'Key',
      label: 'Key',
    }
    updateLayout(previous => ({ ...previous, lights: [...previous.lights, light] }))
    setSelected({ type: 'light', id: light.id })
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
    if (tool === 'camera') {
      addCameraAt(point)
      return
    }
    if (tool === 'light') {
      addLightAt(point)
      return
    }
    if (tool === 'waypoint') {
      if (!selected || selected.type !== 'camera') {
        window.alert('Select a camera marker first, then add a movement waypoint.')
        setTool('select')
        return
      }
      updateLayout(previous => ({
        ...previous,
        cameras: previous.cameras.map(camera => camera.id !== selected.id
          ? camera
          : { ...camera, path: [...(camera.path || []), { x: Math.round(point.x), y: Math.round(point.y) }] }),
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
        if (drag.type === 'camera' || drag.type === 'light') {
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
      const x = Math.min(drawStart.x, previewPoint.x)
      const y = Math.min(drawStart.y, previewPoint.y)
      const width = Math.abs(previewPoint.x - drawStart.x)
      const height = Math.abs(previewPoint.y - drawStart.y)
      if (tool === 'room' && width >= 12 && height >= 12) {
        const room = {
          id: makeId(), x: Math.round(x), y: Math.round(y),
          width: Math.round(width), height: Math.round(height),
          label: 'Room ' + String(layout.rooms.length + 1).padStart(2, '0'),
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
    if (!selected) return
    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].map(item => item.id === selected.id
        ? { ...item, ...patch }
        : item),
    }))
  }

  const changeCameraMovement = (camera, movement) => {
    const shot = shots.find(item => item.id === camera.shotId)
    const currentMovement = shot?.movements?.includes(camera.movement)
      ? camera.movement
      : (shot?.movements?.[0] || 'Static')
    updateSelected({ movement })
    syncShotMovement(camera.shotId, movement, currentMovement === 'Static' ? '' : currentMovement)
  }

  const deleteSelected = () => {
    if (!selected) return
    const collection = selected.type + 's'
    updateLayout(previous => ({
      ...previous,
      [collection]: previous[collection].filter(item => item.id !== selected.id),
    }))
    setSelected(null)
    if (tool === 'waypoint') setTool('select')
  }

  const clearLayout = () => {
    if (!window.confirm('Clear all rooms, walls, camera placements and lights for this scene? This cannot be undone.')) return
    updateLayout(() => ({ ...EMPTY_LAYOUT }))
    setSelected(null)
  }

  const selectShot = (shotId) => {
    setSelectedShotId(shotId)
    const camera = layout.cameras.find(item => item.shotId === shotId)
    if (camera) {
      setSelected({ type: 'camera', id: camera.id })
      setTool('select')
    } else {
      setSelected(null)
    }
  }

  const handleShotPlacement = () => {
    if (!selectedShot) return
    const camera = layout.cameras.find(item => item.shotId === selectedShot.id)
    if (camera) {
      setSelected({ type: 'camera', id: camera.id })
      setTool('select')
    } else {
      setTool('camera')
    }
  }

  const cameraLabel = (camera) => {
    const shot = shots.find(item => item.id === camera.shotId)
    if (!shot) return 'Missing shot'
    return 'SHOT ' + shot.num + (shot.subject ? ' · ' + shot.subject : '')
  }

  const movementForCamera = (camera) => {
    const shot = shots.find(item => item.id === camera.shotId)
    if (shot?.movements?.includes(camera.movement)) return camera.movement
    return shot?.movements?.[0] || 'Static'
  }

  const countLabel = layout.rooms.length + ' rooms · ' + layout.walls.length + ' walls · ' +
    layout.cameras.length + ' cameras · ' + layout.lights.length + ' lights'

  if (!scene) return <div className="app-loading">No scene available. Add a scene in Shot List first.</div>

  return (
    <div className="floorplan-page">
      <div className="floorplan-toolbar">
        <div className="floorplan-toolbar-left">
          <div>
            <label className="floorplan-label" htmlFor="floorplan-scene">Scene</label>
            <select
              id="floorplan-scene"
              className="floorplan-select"
              value={scene.id}
              onChange={event => onActiveSceneChange(event.target.value)}
            >
              {scenes.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {item.name || ('Scene ' + String(index + 1).padStart(2, '0'))}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="floorplan-label" htmlFor="floorplan-shot">Link camera to shot</label>
            <select
              id="floorplan-shot"
              className="floorplan-select"
              value={selectedShot?.id || ''}
              onChange={event => selectShot(event.target.value)}
            >
              {shots.map(shot => (
                <option key={shot.id} value={shot.id}>
                  {shot.num + ' — ' + (shot.subject || 'Untitled shot')}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={handleShotPlacement} disabled={!selectedShot}>
            <Camera size={13} /> {selectedShot && layout.cameras.some(item => item.shotId === selectedShot.id) ? 'Locate Camera' : 'Place Camera'}
          </button>
        </div>
        <div className="floorplan-summary">{countLabel}</div>
      </div>

      <div className="floorplan-toolstrip" role="toolbar" aria-label="Floorplan tools">
        {[
          { id: 'select', label: 'Select / Move', Icon: MousePointer2 },
          { id: 'room', label: 'Draw Room', Icon: Square },
          { id: 'wall', label: 'Draw Wall', Icon: Minus },
          { id: 'camera', label: 'Place Camera', Icon: Camera },
          { id: 'waypoint', label: 'Movement Waypoint', Icon: Route },
          { id: 'light', label: 'Place Light', Icon: Sun },
        ].map(item => (
          <button
            key={item.id}
            className={'floorplan-tool' + (tool === item.id ? ' active' : '')}
            onClick={() => setTool(item.id)}
            aria-pressed={tool === item.id}
            title={item.label}
            disabled={item.id === 'waypoint' && (!selected || selected.type !== 'camera')}
          >
            <item.Icon size={14} /> <span>{item.label}</span>
          </button>
        ))}
        <span className="floorplan-tool-spacer" />
        <button className="floorplan-tool floorplan-clear" onClick={clearLayout}>
          <Trash2 size={13} /> <span>Clear Scene</span>
        </button>
      </div>

      <div className="floorplan-layout">
        <div className="floorplan-map-column">
          <div className="floorplan-map-frame">
            <svg
              ref={svgRef}
              className={'floorplan-map' + (tool === 'select' ? ' cursor-select' : ' cursor-draw')}
              viewBox={'0 0 ' + MAP_WIDTH + ' ' + MAP_HEIGHT}
              preserveAspectRatio="none"
              role="img"
              aria-label="Interactive top-down 2D floorplan canvas"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            >
              <defs>
                <pattern id="floorplan-grid-small" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="var(--border)" strokeWidth="1" />
                </pattern>
                <pattern id="floorplan-grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
                  <rect width="100" height="100" fill="url(#floorplan-grid-small)" />
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--border-strong)" strokeWidth="1.2" />
                </pattern>
                <marker id="floorplan-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="#2563eb" />
                </marker>
              </defs>
              <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="var(--bg)" />
              <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#floorplan-grid-large)" />

              {layout.rooms.map(room => (
                <g key={room.id} onPointerDown={event => beginDrag('room', room, event)}>
                  <rect
                    x={room.x} y={room.y} width={room.width} height={room.height}
                    fill={selected?.type === 'room' && selected.id === room.id ? 'rgba(37,99,235,0.12)' : 'rgba(115,115,115,0.07)'}
                    stroke={selected?.type === 'room' && selected.id === room.id ? '#2563eb' : 'var(--text-muted)'}
                    strokeWidth={selected?.type === 'room' && selected.id === room.id ? 3 : 2}
                    strokeDasharray="7 4"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={room.x + 10} y={room.y + 24} fill="var(--text)" fontSize="14" fontWeight="600" pointerEvents="none">
                    {room.label || 'Room'}
                  </text>
                </g>
              ))}

              {layout.walls.map(wall => (
                <g key={wall.id} onPointerDown={event => beginDrag('wall', wall, event)}>
                  <line
                    x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke={selected?.type === 'wall' && selected.id === wall.id ? '#2563eb' : 'var(--text)'}
                    strokeWidth={selected?.type === 'wall' && selected.id === wall.id ? 7 : 5}
                    strokeLinecap="square"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                    stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}

              {layout.cameras.map(camera => {
                const shot = shots.find(item => item.id === camera.shotId)
                const pathPoints = [{ x: camera.x, y: camera.y }, ...(camera.path || [])]
                const points = pathPoints.map(point => point.x + ',' + point.y).join(' ')
                const isSelected = selected?.type === 'camera' && selected.id === camera.id
                return (
                  <g key={camera.id}>
                    {pathPoints.length > 1 && (
                      <>
                        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="3" strokeDasharray="9 6" opacity="0.85" vectorEffect="non-scaling-stroke" />
                        <line
                          x1={pathPoints[pathPoints.length - 2].x}
                          y1={pathPoints[pathPoints.length - 2].y}
                          x2={pathPoints[pathPoints.length - 1].x}
                          y2={pathPoints[pathPoints.length - 1].y}
                          stroke="#2563eb" strokeWidth="2" markerEnd="url(#floorplan-arrow)"
                          vectorEffect="non-scaling-stroke"
                        />
                        {camera.path.map((point, index) => (
                          <circle key={index} cx={point.x} cy={point.y} r="5" fill="#fff" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        ))}
                      </>
                    )}
                    <g
                      transform={'translate(' + camera.x + ' ' + camera.y + ')'}
                      onPointerDown={event => beginDrag('camera', camera, event)}
                    >
                      <path d="M -2 -11 L 22 -20 L 22 20 L -2 11 Z" fill="rgba(37,99,235,0.15)" stroke="#2563eb" strokeWidth="1.5" transform={'rotate(' + (camera.angle || 0) + ')'} pointerEvents="none" />
                      <g transform={'rotate(' + (camera.angle || 0) + ')'} pointerEvents="none">
                        <rect x="-13" y="-10" width="20" height="20" rx="3" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
                        <circle cx="0" cy="0" r="4" fill="#fff" />
                        <circle cx="0" cy="0" r="1.5" fill="#2563eb" />
                      </g>
                      {isSelected && <circle cx="0" cy="0" r="18" fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="3 3" />}
                      <text x="0" y="29" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" pointerEvents="none">
                        {shot ? 'S' + shot.num : 'S?'}
                      </text>
                    </g>
                  </g>
                )
              })}

              {layout.lights.map(light => {
                const isSelected = selected?.type === 'light' && selected.id === light.id
                return (
                  <g key={light.id} transform={'translate(' + light.x + ' ' + light.y + ')'} onPointerDown={event => beginDrag('light', light, event)}>
                    <g transform={'rotate(' + (light.angle || 0) + ')'} pointerEvents="none">
                      <path d="M 0 -7 L 36 -22 L 36 22 L 0 7 Z" fill="#f59e0b" opacity="0.14" />
                      <path d="M 0 -7 L 36 -22 M 0 7 L 36 22" stroke="#d97706" strokeWidth="1.5" strokeDasharray="3 3" />
                    </g>
                    <circle cx="0" cy="0" r={isSelected ? 13 : 11} fill="#f59e0b" stroke={isSelected ? '#92400e' : '#fff'} strokeWidth="2" />
                    <circle cx="0" cy="0" r="4" fill="#fff" />
                    <text x="0" y="27" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" pointerEvents="none">
                      {light.label || light.type || 'Light'}
                    </text>
                  </g>
                )
              })}

              {drawStart && previewPoint && tool === 'room' && (
                <rect
                  x={Math.min(drawStart.x, previewPoint.x)}
                  y={Math.min(drawStart.y, previewPoint.y)}
                  width={Math.abs(previewPoint.x - drawStart.x)}
                  height={Math.abs(previewPoint.y - drawStart.y)}
                  fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke" pointerEvents="none"
                />
              )}
              {drawStart && previewPoint && tool === 'wall' && (
                <line
                  x1={drawStart.x} y1={drawStart.y} x2={previewPoint.x} y2={previewPoint.y}
                  stroke="#2563eb" strokeWidth="3" strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke" pointerEvents="none"
                />
              )}
            </svg>
          </div>
          <div className="floorplan-map-help">
            <span><Grid2X2 size={13} /> Grid snap guide</span>
            <span><Camera size={13} /> Blue = camera & movement</span>
            <span><Sun size={13} /> Amber = lighting</span>
            <span>Drag markers to reposition</span>
          </div>
        </div>

        <aside className="floorplan-sidebar">
          <section className="floorplan-panel">
            <div className="floorplan-panel-heading">
              <span>Shot setups</span><span className="floorplan-count">{shots.length}</span>
            </div>
            {shots.length === 0 ? (
              <p className="floorplan-muted">Add shots in Shot List first.</p>
            ) : shots.map(shot => {
              const camera = layout.cameras.find(item => item.shotId === shot.id)
              const isActive = selectedShot?.id === shot.id
              return (
                <button
                  key={shot.id}
                  className={'floorplan-shot-item' + (isActive ? ' active' : '')}
                  onClick={() => selectShot(shot.id)}
                >
                  <span className="floorplan-shot-icon"><Camera size={14} /></span>
                  <span className="floorplan-shot-copy">
                    <strong>{shot.num} · {shot.subject || 'Untitled shot'}</strong>
                    <small>{shot.camera || 'Camera not specified'} · {camera ? 'Placed on map' : 'Not placed'}</small>
                  </span>
                  <span className={'floorplan-shot-status' + (camera ? ' placed' : '')}>{camera ? '●' : '○'}</span>
                </button>
              )
            })}
          </section>

          <section className="floorplan-panel">
            <div className="floorplan-panel-heading">
              <span>Selection</span>
              {selectedEntity && (
                <button className="btn btn-ghost floorplan-delete" onClick={deleteSelected} title="Delete selected item">
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
            {!selectedEntity ? (
              <p className="floorplan-muted">Select a room, wall, camera or light on the canvas to edit it.</p>
            ) : selected.type === 'camera' ? (
              <div className="floorplan-editor-fields">
                <div className="floorplan-linked-shot"><Camera size={15} /><span>{cameraLabel(selectedEntity)}</span></div>
                <label className="floorplan-label" htmlFor="camera-movement">Camera movement</label>
                <select
                  id="camera-movement"
                  className="floorplan-select full"
                  value={movementForCamera(selectedEntity)}
                  onChange={event => changeCameraMovement(selectedEntity, event.target.value)}
                >
                  {MOVEMENTS.map(movement => <option key={movement} value={movement}>{movement}</option>)}
                </select>
                <p className="floorplan-hint">Movement is synced to the linked shot in Shot List.</p>
                <div className="floorplan-coordinate-grid">
                  <label>X <input type="number" min="0" max={MAP_WIDTH} value={Math.round(selectedEntity.x)} onChange={event => updateSelected({ x: clamp(event.target.value, 0, MAP_WIDTH) })} /></label>
                  <label>Y <input type="number" min="0" max={MAP_HEIGHT} value={Math.round(selectedEntity.y)} onChange={event => updateSelected({ y: clamp(event.target.value, 0, MAP_HEIGHT) })} /></label>
                </div>
                <div className="floorplan-inline-controls">
                  <button className="btn btn-secondary" onClick={() => updateSelected({ angle: ((selectedEntity.angle || 0) + 15) % 360 })}><RotateCw size={12} /> Rotate 15°</button>
                  <button className="btn btn-secondary" onClick={() => setTool('waypoint')}><Route size={12} /> Add waypoint</button>
                </div>
                <div className="floorplan-path-meta">{(selectedEntity.path || []).length} movement waypoint(s)</div>
                {(selectedEntity.path || []).length > 0 && (
                  <button className="floorplan-text-button" onClick={() => updateSelected({ path: [] })}>Clear movement path</button>
                )}
              </div>
            ) : selected.type === 'light' ? (
              <div className="floorplan-editor-fields">
                <label className="floorplan-label" htmlFor="light-type">Lighting type</label>
                <select id="light-type" className="floorplan-select full" value={selectedEntity.type} onChange={event => updateSelected({ type: event.target.value, label: event.target.value })}>
                  {LIGHT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                <label className="floorplan-label" htmlFor="light-label">Label</label>
                <input id="light-label" className="floorplan-input" value={selectedEntity.label || ''} maxLength={60} onChange={event => updateSelected({ label: event.target.value })} />
                <div className="floorplan-coordinate-grid">
                  <label>X <input type="number" min="0" max={MAP_WIDTH} value={Math.round(selectedEntity.x)} onChange={event => updateSelected({ x: clamp(event.target.value, 0, MAP_WIDTH) })} /></label>
                  <label>Y <input type="number" min="0" max={MAP_HEIGHT} value={Math.round(selectedEntity.y)} onChange={event => updateSelected({ y: clamp(event.target.value, 0, MAP_HEIGHT) })} /></label>
                </div>
                <button className="btn btn-secondary" onClick={() => updateSelected({ angle: ((selectedEntity.angle || 0) + 15) % 360 })}><RotateCw size={12} /> Rotate light direction</button>
              </div>
            ) : selected.type === 'room' ? (
              <div className="floorplan-editor-fields">
                <label className="floorplan-label" htmlFor="room-label">Room label</label>
                <input id="room-label" className="floorplan-input" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                <div className="floorplan-coordinate-grid">
                  <label>X <input type="number" min="0" max={MAP_WIDTH} value={Math.round(selectedEntity.x)} onChange={event => updateSelected({ x: clamp(event.target.value, 0, MAP_WIDTH) })} /></label>
                  <label>Y <input type="number" min="0" max={MAP_HEIGHT} value={Math.round(selectedEntity.y)} onChange={event => updateSelected({ y: clamp(event.target.value, 0, MAP_HEIGHT) })} /></label>
                </div>
                <p className="floorplan-hint">Drag the room boundary to reposition it. Use Draw Wall to add partitions.</p>
              </div>
            ) : (
              <p className="floorplan-muted">Wall selected. Drag it to reposition or delete it.</p>
            )}
          </section>

          <section className="floorplan-panel floorplan-legend-panel">
            <div className="floorplan-panel-heading"><span>Floorplan guide</span><MapPin size={14} /></div>
            <p className="floorplan-muted">1. Draw room areas, then draw walls.</p>
            <p className="floorplan-muted">2. Choose a shot and place its camera marker.</p>
            <p className="floorplan-muted">3. Add movement waypoints and select the movement type.</p>
            <p className="floorplan-muted">4. Place and rotate lights to map their direction.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
