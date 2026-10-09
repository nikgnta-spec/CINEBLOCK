import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Hand, Square, Minus, Route, Trash2, Plus, Layers2, X, Maximize2,
} from 'lucide-react'
import SceneNavigator from './SceneNavigator'
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
const EMPTY_LAYOUT = { rooms: [], walls: [], props: [], actors: [], cameras: [], lights: [] }

function getFittedViewBox(layout) {
  const points = []
  const addPoint = (x, y) => {
    const px = Number(x)
    const py = Number(y)
    if (Number.isFinite(px) && Number.isFinite(py)) points.push({ x: px, y: py })
  }

  ;(layout.rooms || []).forEach(room => {
    addPoint(room.x, room.y)
    addPoint(Number(room.x) + Number(room.width), Number(room.y) + Number(room.height))
  })
  ;(layout.walls || []).forEach(wall => {
    addPoint(wall.x1, wall.y1)
    addPoint(wall.x2, wall.y2)
  })
  ;['props', 'actors', 'cameras', 'lights'].forEach(collection => {
    ;(layout[collection] || []).forEach(item => {
      const halfWidth = collection === 'props' ? (Number(item.width) || 52) / 2 : 22
      const halfHeight = collection === 'props' ? (Number(item.height) || 36) / 2 : 22
      addPoint(Number(item.x) - halfWidth, Number(item.y) - halfHeight)
      addPoint(Number(item.x) + halfWidth, Number(item.y) + halfHeight)
      ;(Array.isArray(item.path) ? item.path : []).forEach(point => addPoint(point.x, point.y))
    })
  })

  if (!points.length) return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT }

  const padding = 52
  const minX = Math.max(0, Math.min(...points.map(point => point.x)) - padding)
  const minY = Math.max(0, Math.min(...points.map(point => point.y)) - padding)
  const maxX = Math.min(MAP_WIDTH, Math.max(...points.map(point => point.x)) + padding)
  const maxY = Math.min(MAP_HEIGHT, Math.max(...points.map(point => point.y)) + padding)
  let width = Math.max(220, maxX - minX)
  let height = Math.max(143, maxY - minY)
  const mapAspect = MAP_WIDTH / MAP_HEIGHT

  // Keep the original world-coordinate aspect ratio so fitting the view does
  // not distort room dimensions or camera/light fields of view.
  if (width / height < mapAspect) width = height * mapAspect
  else height = width / mapAspect
  const scale = Math.min(1, MAP_WIDTH / width, MAP_HEIGHT / height)
  width *= scale
  height *= scale

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    x: clamp(centerX - width / 2, 0, MAP_WIDTH - width),
    y: clamp(centerY - height / 2, 0, MAP_HEIGHT - height),
    width,
    height,
  }
}
const PROP_TYPES = ['Table', 'Chair', 'Sofa', 'Bed', 'Desk', 'Cabinet', 'Counter', 'Custom']
const RESIZE_HANDLES = [
  { key: 'nw', sx: -1, sy: -1, cursor: 'nwse-resize' },
  { key: 'ne', sx: 1, sy: -1, cursor: 'nesw-resize' },
  { key: 'sw', sx: -1, sy: 1, cursor: 'nesw-resize' },
  { key: 'se', sx: 1, sy: 1, cursor: 'nwse-resize' },
]
const ROOM_SIDES = [
  { value: 'top', label: 'Top wall' },
  { value: 'right', label: 'Right wall' },
  { value: 'bottom', label: 'Bottom wall' },
  { value: 'left', label: 'Left wall' },
]
const getOpeningSegments = (length, openings = []) => {
  const ranges = openings
    .map(opening => {
      const width = Math.min(Number(opening.width) || 48, length)
      const center = clamp(opening.offset, 0, 1) * length
      return { start: clamp(center - width / 2, 0, length), end: clamp(center + width / 2, 0, length) }
    })
    .sort((a, b) => a.start - b.start)
  const segments = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ start: cursor, end: range.start })
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < length) segments.push({ start: cursor, end: length })
  return segments
}
const getRoomOpeningPlacement = (room, opening) => {
  const side = ROOM_SIDES.some(item => item.value === opening.side) ? opening.side : 'bottom'
  const offset = clamp(opening.offset, 0.05, 0.95)
  if (side === 'top') return { x: room.x + offset * room.width, y: room.y, angle: 180, length: room.width }
  if (side === 'right') return { x: room.x + room.width, y: room.y + offset * room.height, angle: -90, length: room.height }
  if (side === 'left') return { x: room.x, y: room.y + offset * room.height, angle: 90, length: room.height }
  return { x: room.x + offset * room.width, y: room.y + room.height, angle: 0, length: room.width }
}
const getWallMetrics = wall => {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  return { length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI, ux: dx / (Math.hypot(dx, dy) || 1), uy: dy / (Math.hypot(dx, dy) || 1) }
}
const getOpeningSymbol = (opening, width) => (
  opening.type === 'door'
    ? `M ${-width / 2} 0 V ${-width} M ${-width / 2} ${-width} A ${width} ${width} 0 0 1 ${width / 2} 0`
    : `M ${-width / 2} -4 H ${width / 2} M ${-width / 2} 0 H ${width / 2} M ${-width / 2} 4 H ${width / 2} M ${-width / 2} -7 V 7 M ${width / 2} -7 V 7`
)
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
const formatMeters = value => (Math.max(0, Number(value) || 0) / 100).toFixed(2) + ' m'
const makeId = () => crypto.randomUUID()
const padNum = number => String(number).padStart(2, '0')
const normalizeAngle = angle => ((angle % 360) + 360) % 360

function FloorplanObjectIcon({ type, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={type === 'camera' ? '-36 -25 72 50' : type === 'light' ? '-22 -22 44 44' : ['door', 'window', 'prop', 'room', 'wall'].includes(type) ? '-26 -22 52 44' : '-50 -42 100 84'}
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {type === 'room' ? (
        <rect x="-17" y="-13" width="34" height="26" />
      ) : type === 'wall' ? (
        <path d="M-20 0 H20" strokeWidth="5" />
      ) : type === 'door' ? (
        <g>
          <path d="M-16 -5 H16 M-16 5 H16" />
          <path d="M-16 5 V-17 A22 22 0 0 1 6 5" />
        </g>
      ) : type === 'window' ? (
        <g>
          <path d="M-20 -7 H20 M-20 0 H20 M-20 7 H20" />
          <path d="M-20 -10 V10 M20 -10 V10" />
        </g>
      ) : type === 'prop' ? (
        <g>
          <rect x="-16" y="-12" width="32" height="24" rx="2" />
          <path d="M-10 -7 H10 M-10 7 H10" />
        </g>
      ) : type === 'actor' ? (
        <g transform="scale(0.68)">
          <path d="M-22 -6 C-30 -10 -37 -6 -40 2 C-43 12 -36 22 -27 23 C-21 31 -10 34 0 34 C10 34 21 31 27 23 C36 22 43 12 40 2 C37 -6 30 -10 22 -6" />
          <path d="M0 -31 C-17 -31 -22 -17 -21 -6 C-20 5 -15 13 -8 15 C-5 16 -4 20 0 21 C4 20 5 16 8 15 C15 13 20 5 21 -6 C22 -17 17 -31 0 -31 Z" />
          <path d="M-18 0 C-12 -5 -7 6 0 6 C7 6 12 -5 18 0" />
          <path d="M-25 12 C-28 15 -28 19 -25 23 M25 12 C28 15 28 19 25 23" />
        </g>
      ) : type === 'camera' ? (
        <g>
          <path d="M9 -9 L33 -20 L33 20 L9 9 Z" />
          <rect x="-29" y="-15" width="40" height="30" rx="6" />
        </g>
      ) : (
        <g transform="rotate(90)" strokeWidth="2.8">
          <path d="M-13 -8 L-8 -11 L3 -11 L11 -7 L11 7 L3 11 L-8 11 L-13 8 Z" />
          <path d="M-13 -5 L-18 -9 M-13 5 L-18 9" />
          <circle cx="7" cy="0" r="4.2" fill="currentColor" stroke="none" />
          <path d="M-2 -6 L-2 6" strokeOpacity="0.65" />
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
    ...(layout.props || []),
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

const FULL_FRAME_SENSOR_WIDTH_MM = 36
const FOV_RADIUS = 190
const FOV_START_X = 12

function parseFocalLengthRange(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mm)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*mm?/i)
  if (rangeMatch) {
    const first = Number(rangeMatch[1])
    const second = Number(rangeMatch[2])
    const focalMin = Math.min(first, second)
    const focalMax = Math.max(first, second)
    if (focalMin > 0 && focalMax > 0) return { min: focalMin, max: focalMax }
  }
  const withUnit = text.match(/(\d+(?:\.\d+)?)\s*mm/i)
  const fallback = withUnit || text.match(/^\s*(\d+(?:\.\d+)?)\s*$/)
  if (!fallback) return null
  const focalLength = Number(fallback[1])
  return focalLength > 0 ? { min: focalLength, max: focalLength } : null
}

function horizontalFovDegrees(focalLength) {
  return 2 * Math.atan(FULL_FRAME_SENSOR_WIDTH_MM / (2 * focalLength)) * 180 / Math.PI
}

function fovSectorPath(fovDegrees) {
  const halfAngle = (fovDegrees / 2) * Math.PI / 180
  const x1 = FOV_RADIUS * Math.cos(-halfAngle)
  const y1 = FOV_RADIUS * Math.sin(-halfAngle)
  const x2 = FOV_RADIUS * Math.cos(halfAngle)
  const y2 = FOV_RADIUS * Math.sin(halfAngle)
  return 'M ' + FOV_START_X + ' 0 L ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
    + ' A ' + FOV_RADIUS + ' ' + FOV_RADIUS + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z'
}

const LIGHT_CONE_RADIUS = 220
const LIGHT_CONE_ANGLE = 56

function lightConeSectorPath() {
  const halfAngle = (LIGHT_CONE_ANGLE / 2) * Math.PI / 180
  const x1 = LIGHT_CONE_RADIUS * Math.cos(-halfAngle)
  const y1 = LIGHT_CONE_RADIUS * Math.sin(-halfAngle)
  const x2 = LIGHT_CONE_RADIUS * Math.cos(halfAngle)
  const y2 = LIGHT_CONE_RADIUS * Math.sin(halfAngle)
  return 'M 14 0 L ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
    + ' A ' + LIGHT_CONE_RADIUS + ' ' + LIGHT_CONE_RADIUS + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z'
}

function formatFov(focalRange) {
  if (!focalRange) return ''
  const widest = horizontalFovDegrees(focalRange.min)
  const narrowest = horizontalFovDegrees(focalRange.max)
  if (focalRange.min === focalRange.max) return widest.toFixed(1) + '°'
  return widest.toFixed(1) + '° → ' + narrowest.toFixed(1) + '°'
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
  onAddScene,
  onRenameScene,
  floorplans,
  onFloorplansChange,
  selectedShotId,
  onSelectedShotIdChange,
}) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const normalizedSceneLayoutsRef = useRef(new Set())
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [selectedWaypoint, setSelectedWaypoint] = useState(null)
  const [drawStart, setDrawStart] = useState(null)
  const [previewPoint, setPreviewPoint] = useState(null)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT })

  const scene = scenes.find(item => item.id === activeSceneId) || scenes[0]
  const layout = scene ? (floorplans?.[scene.id] || EMPTY_LAYOUT) : EMPTY_LAYOUT
  const allObjects = [
    ...layout.rooms.map(item => ({ ...item, entityType: 'room' })),
    ...layout.walls.map(item => ({ ...item, entityType: 'wall' })),
    ...layout.props.map(item => ({ ...item, entityType: 'prop' })),
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
    setSelectedWaypoint(null)
    setTool('select')
    dragRef.current = null
    setDrawStart(null)
    setPreviewPoint(null)
    setViewBox(getFittedViewBox(layout))
  }, [scene?.id])

  useEffect(() => {
    if (!scene || !selected) return
    if (!(layout[selected.type + 's'] || []).some(item => item.id === selected.id)) {
      setSelected(null)
      setTool('select')
    }
  }, [scene?.id, layout, selected])

  useEffect(() => {
    if (!scene || !selectedShotId) return
    const linkedCamera = layout.cameras.find(camera => camera.shotId === selectedShotId)
    setSelected(linkedCamera ? { type: 'camera', id: linkedCamera.id } : null)
    setSelectedWaypoint(null)
  }, [scene?.id, selectedShotId, layout.cameras])

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
      x: clamp(viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width, 0, MAP_WIDTH),
      y: clamp(viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height, 0, MAP_HEIGHT),
    }
  }

  const zoomCanvas = factor => {
    setViewBox(current => {
      const width = clamp(current.width * factor, 220, MAP_WIDTH)
      const height = width / (MAP_WIDTH / MAP_HEIGHT)
      const centerX = current.x + current.width / 2
      const centerY = current.y + current.height / 2
      return {
        x: clamp(centerX - width / 2, 0, MAP_WIDTH - width),
        y: clamp(centerY - height / 2, 0, MAP_HEIGHT - height),
        width,
        height,
      }
    })
  }

  const fitCanvas = () => setViewBox(getFittedViewBox(layout))

  // Object buttons create an object immediately. The new marker is selected and
  // can be dragged straight to its final position without another placement click.
  const addObject = type => {
    const collection = type + 's'
    const count = (layout[collection] || []).length
    const position = findAvailablePosition(layout)
    let object

    if (type === 'actor') {
      object = { id: makeId(), ...position, angle: 0, label: 'Actor ' + padNum(count + 1), path: [] }
      updateLayout(previous => ({ ...previous, actors: [...previous.actors, object] }))
    } else if (type === 'light') {
      object = { id: makeId(), ...position, angle: 0, lightType: 'Key', label: 'Light ' + padNum(count + 1) }
      updateLayout(previous => ({ ...previous, lights: [...previous.lights, object] }))
    } else if (type === 'prop') {
      object = { id: makeId(), ...position, angle: 0, width: 52, height: 36, label: 'Table ' + padNum(count + 1), propType: 'Table' }
      updateLayout(previous => ({ ...previous, props: [...previous.props, object] }))
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
      object = { id: makeId(), ...position, angle: 0, shotId: targetShot.id, path: [] }
      updateLayout(previous => ({ ...previous, cameras: [...previous.cameras, object] }))
    }

    setSelected({ type, id: object.id })
    setSelectedWaypoint(null)
    setTool('select')
  }

  const beginResize = (type, item, sx, sy, event) => {
    if (tool === 'pan') return
    event.stopPropagation()
    event.preventDefault()
    const point = getPoint(event)
    dragRef.current = {
      mode: 'resize',
      type,
      id: item.id,
      signX: sx,
      signY: sy,
      start: point,
      original: { ...item },
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
    setSelectedWaypoint(null)
    setTool('select')
  }

  const beginWallEndpointDrag = (wall, endpoint, event) => {
    if (tool === 'pan') return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = {
      mode: 'wall-endpoint',
      id: wall.id,
      endpoint,
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type: 'wall', id: wall.id })
    setSelectedWaypoint(null)
    setTool('select')
  }

  const beginObjectDrag = (type, item, event) => {
    if (tool === 'pan') return
    if (type === 'camera') onSelectedShotIdChange?.(item.shotId || '')
    else onSelectedShotIdChange?.('')
    event.stopPropagation()
    if (tool === 'room' || tool === 'wall') return
    if (tool === 'path') setTool('select')
    const point = getPoint(event)
    dragRef.current = { mode: 'move', type, id: item.id, start: point, original: item }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
    setSelectedWaypoint(null)
  }

  const beginWaypointDrag = (type, item, pathIndex, event) => {
    if (tool === 'pan') return
    event.stopPropagation()
    const point = getPoint(event)
    const waypoint = (item.path || [])[pathIndex]
    if (!waypoint) return
    dragRef.current = {
      mode: 'waypoint',
      type,
      id: item.id,
      pathIndex,
      start: point,
      original: waypoint,
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type, id: item.id })
    setSelectedWaypoint({ type, id: item.id, index: pathIndex })
    setTool('select')
  }

  const beginRotate = (type, item, event) => {
    if (tool === 'pan') return
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
    setSelectedWaypoint(null)
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
    setSelectedWaypoint(null)
    updateLayout(previous => ({
      ...previous,
      [selectedType + 's']: previous[selectedType + 's'].map(item => item.id !== selectedEntity.id
        ? item
        : { ...item, path: [...(item.path || []), { x: Math.round(point.x), y: Math.round(point.y) }] }),
    }))
  }

  const addOpening = type => {
    if (!selectedEntity || !['room', 'wall'].includes(selectedType)) return
    const opening = {
      id: makeId(),
      type,
      offset: 0.5,
      width: type === 'door' ? 48 : 58,
      ...(selectedType === 'room' ? { side: 'bottom' } : {}),
    }
    updateSelected({ openings: [...(selectedEntity.openings || []), opening] })
    setTool('select')
  }

  const updateOpening = (openingId, patch) => {
    if (!selectedEntity || !['room', 'wall'].includes(selectedType)) return
    updateSelected({
      openings: (selectedEntity.openings || []).map(opening => opening.id === openingId ? { ...opening, ...patch } : opening),
    })
  }

  const removeOpening = openingId => {
    if (!selectedEntity || !['room', 'wall'].includes(selectedType)) return
    updateSelected({ openings: (selectedEntity.openings || []).filter(opening => opening.id !== openingId) })
  }

  const beginOpeningDrag = (hostType, host, opening, event) => {
    if (tool === 'pan') return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = { mode: 'opening', type: hostType, id: host.id, openingId: opening.id }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type: hostType, id: host.id })
    setSelectedWaypoint(null)
    setTool('select')
  }

  const handleCanvasPointerDown = event => {
    if (tool === 'pan') {
      event.preventDefault()
      svgRef.current?.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        mode: 'pan',
        startClientX: event.clientX,
        startClientY: event.clientY,
        viewBox: { ...viewBox },
      }
      return
    }
    const point = getPoint(event)
    if (tool === 'room' || tool === 'wall') {
      svgRef.current?.setPointerCapture?.(event.pointerId)
      setDrawStart(point)
      setPreviewPoint(point)
      return
    }
    if (tool === 'select') {
      setSelected(null)
      setSelectedWaypoint(null)
    }
  }

  const handleCanvasClick = event => {
    if (tool !== 'path') return
    if (event.target?.closest?.('[data-floorplan-object="true"], [data-floorplan-waypoint="true"]')) return
    // Double-click finishes the path and returns to Select/Move.
    if (event.detail > 1) {
      setTool('select')
      return
    }
    appendWaypoint(getPoint(event))
  }

  const handleCanvasPointerMove = event => {
    const drag = dragRef.current
    if (drag?.mode === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || !rect.width || !rect.height) return
      const dx = ((event.clientX - drag.startClientX) / rect.width) * drag.viewBox.width
      const dy = ((event.clientY - drag.startClientY) / rect.height) * drag.viewBox.height
      setViewBox({
        ...drag.viewBox,
        x: clamp(drag.viewBox.x - dx, 0, MAP_WIDTH - drag.viewBox.width),
        y: clamp(drag.viewBox.y - dy, 0, MAP_HEIGHT - drag.viewBox.height),
      })
      return
    }
    const point = getPoint(event)
    if (drawStart) {
      setPreviewPoint(point)
      return
    }
    if (!drag) return

    if (drag.mode === 'opening') {
      const collection = drag.type + 's'
      const host = (layout[collection] || []).find(item => item.id === drag.id)
      const opening = host?.openings?.find(item => item.id === drag.openingId)
      if (!host || !opening) return

      let patch = {}
      let length = 1
      let offset = 0.5
      if (drag.type === 'wall') {
        const metrics = getWallMetrics(host)
        length = metrics.length || 1
        offset = ((point.x - host.x1) * metrics.ux + (point.y - host.y1) * metrics.uy) / length
      } else {
        const edges = [
          { side: 'top', x1: host.x, y1: host.y, x2: host.x + host.width, y2: host.y },
          { side: 'right', x1: host.x + host.width, y1: host.y, x2: host.x + host.width, y2: host.y + host.height },
          { side: 'bottom', x1: host.x, y1: host.y + host.height, x2: host.x + host.width, y2: host.y + host.height },
          { side: 'left', x1: host.x, y1: host.y, x2: host.x, y2: host.y + host.height },
        ]
        const projectedEdges = edges.map(edge => {
          const projection = getWallMetrics({ x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 })
          const edgeLength = projection.length || 1
          const rawOffset = ((point.x - edge.x1) * projection.ux + (point.y - edge.y1) * projection.uy) / edgeLength
          const clampedOffset = clamp(rawOffset, 0, 1)
          const projectedX = edge.x1 + projection.ux * edgeLength * clampedOffset
          const projectedY = edge.y1 + projection.uy * edgeLength * clampedOffset
          return { ...edge, length: edgeLength, offset: rawOffset, distance: Math.hypot(point.x - projectedX, point.y - projectedY) }
        })
        const nearestEdge = projectedEdges.reduce((best, edge) => edge.distance < best.distance ? edge : best)
        length = nearestEdge.length
        offset = nearestEdge.offset
        patch.side = nearestEdge.side
      }
      const openingWidth = Math.min(Number(opening.width) || 48, length)
      const minimumOffset = Math.min(0.49, openingWidth / (2 * length))
      patch.offset = clamp(offset, minimumOffset, 1 - minimumOffset)
      updateLayout(previous => ({
        ...previous,
        [collection]: previous[collection].map(item => item.id !== drag.id
          ? item
          : {
            ...item,
            openings: (item.openings || []).map(entry => entry.id === drag.openingId
              ? { ...entry, ...patch }
              : entry),
          }),
      }))
      return
    }

    if (drag.mode === 'wall-endpoint') {
      const endpointPatch = drag.endpoint === 'start'
        ? { x1: Math.round(point.x), y1: Math.round(point.y) }
        : { x2: Math.round(point.x), y2: Math.round(point.y) }
      updateLayout(previous => ({
        ...previous,
        walls: previous.walls.map(wall => wall.id === drag.id ? { ...wall, ...endpointPatch } : wall),
      }))
      return
    }

    if (drag.mode === 'resize') {
      const original = drag.original
      const dx = point.x - drag.start.x
      const dy = point.y - drag.start.y
      if (drag.type === 'room') {
        const nextWidth = Math.round(clamp(
          original.width + dx * drag.signX,
          40,
          drag.signX < 0 ? Math.min(MAP_WIDTH, original.x + original.width) : Math.max(40, MAP_WIDTH - original.x),
        ))
        const nextHeight = Math.round(clamp(
          original.height + dy * drag.signY,
          40,
          drag.signY < 0 ? Math.min(MAP_HEIGHT, original.y + original.height) : Math.max(40, MAP_HEIGHT - original.y),
        ))
        const nextRoom = {
          ...original,
          width: nextWidth,
          height: nextHeight,
          x: Math.round(drag.signX < 0 ? original.x + original.width - nextWidth : original.x),
          y: Math.round(drag.signY < 0 ? original.y + original.height - nextHeight : original.y),
        }
        updateLayout(previous => ({
          ...previous,
          rooms: previous.rooms.map(room => room.id === drag.id ? nextRoom : room),
        }))
      } else {
        const angle = (Number(original.angle) || 0) * Math.PI / 180
        const localDx = dx * Math.cos(angle) + dy * Math.sin(angle)
        const localDy = -dx * Math.sin(angle) + dy * Math.cos(angle)
        const minWidth = 12
        const minHeight = 8
        const nextWidth = Math.round(clamp(original.width + localDx * drag.signX, minWidth, 300))
        const nextHeight = Math.round(clamp(original.height + localDy * drag.signY, minHeight, 200))
        const shiftX = (nextWidth - original.width) * drag.signX / 2
        const shiftY = (nextHeight - original.height) * drag.signY / 2
        const nextItem = {
          ...original,
          width: nextWidth,
          height: nextHeight,
          x: Math.round(clamp(original.x + shiftX * Math.cos(angle) - shiftY * Math.sin(angle), 0, MAP_WIDTH)),
          y: Math.round(clamp(original.y + shiftX * Math.sin(angle) + shiftY * Math.cos(angle), 0, MAP_HEIGHT)),
        }
        updateLayout(previous => ({
          ...previous,
          [drag.type + 's']: previous[drag.type + 's'].map(item => item.id === drag.id ? nextItem : item),
        }))
      }
      return
    }

    if (drag.mode === 'waypoint') {
      const waypoint = {
        x: Math.round(clamp(point.x, 0, MAP_WIDTH)),
        y: Math.round(clamp(point.y, 0, MAP_HEIGHT)),
      }
      updateLayout(previous => ({
        ...previous,
        [drag.type + 's']: previous[drag.type + 's'].map(item => item.id !== drag.id
          ? item
          : {
            ...item,
            path: (item.path || []).map((current, index) => index === drag.pathIndex ? waypoint : current),
          }),
      }))
      return
    }

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
        if (['actor', 'camera', 'light', 'door', 'window', 'prop'].includes(drag.type)) {
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
          thickness: 6,
          openings: [],
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
    if (Object.prototype.hasOwnProperty.call(patch, 'path')) setSelectedWaypoint(null)
    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].map(item => (
        item.id === selected.id ? { ...item, ...patch } : item
      )),
    }))
  }

  const deleteSelectedWaypoint = () => {
    if (!selectedWaypoint || !selected || selectedWaypoint.type !== selected.type || selectedWaypoint.id !== selected.id) return
    const { type, id, index } = selectedWaypoint
    const item = (layout[type + 's'] || []).find(entry => entry.id === id)
    if (!item || !Array.isArray(item.path) || !item.path[index]) return
    const nextPath = item.path.filter((_, pathIndex) => pathIndex !== index)
    updateLayout(previous => ({
      ...previous,
      [type + 's']: previous[type + 's'].map(entry => entry.id === id
        ? { ...entry, path: nextPath }
        : entry),
    }))
    setSelectedWaypoint(nextPath.length
      ? { type, id, index: Math.min(index, nextPath.length - 1) }
      : null)
  }

  useEffect(() => {
    const handleWaypointDeleteKey = event => {
      if (!selectedWaypoint || !['Delete', 'Backspace'].includes(event.key)) return
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )) return
      event.preventDefault()
      deleteSelectedWaypoint()
    }
    window.addEventListener('keydown', handleWaypointDeleteKey)
    return () => window.removeEventListener('keydown', handleWaypointDeleteKey)
  }, [selectedWaypoint, selected, layout])

  const changeCameraLink = (camera, nextShotId) => {
    const anotherCamera = layout.cameras.find(item => item.shotId === nextShotId && item.id !== camera.id)
    if (nextShotId && anotherCamera) {
      window.alert('Shot tersebut sudah memiliki marker kamera. Pilih shot yang lain.')
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
    setSelectedWaypoint(null)
    setTool('select')
  }

  const clearLayout = () => {
    if (!window.confirm('Kosongkan room, wall, properti, aktor, kamera, dan lampu pada scene ini?')) return
    updateLayout(() => ({ ...EMPTY_LAYOUT }))
    setSelected(null)
    setSelectedWaypoint(null)
    setTool('select')
  }

  const objectName = (type, item) => {
    if (type === 'camera') {
      const shot = scene.shots.find(entry => entry.id === item.shotId)
      return shot ? ('Shot ' + shot.num + (shot.subject ? ' — ' + shot.subject : '')) : 'Unlinked camera'
    }
    if (type === 'light') return item.label || item.lightType || 'Light'
    if (type === 'prop') return item.propType || 'Prop'
    const fallback = ({ room: 'Room', wall: 'Wall', door: 'Door', window: 'Window', actor: 'Actor' })[type] || type
    return item.label || fallback
  }

  const objectTypeLabel = type => ({
    actor: 'Actor', camera: 'Camera', light: 'Lighting', room: 'Room',
    wall: 'Wall', prop: 'Prop',
  })[type] || type
  const objectCount = layout.rooms.length + layout.walls.length + layout.props.length + layout.actors.length + layout.cameras.length + layout.lights.length
  const selectedPath = selectedEntity?.path || []
  if (!scene) return null

  return (
    <div className="floorplan-workspace">
      <header className="floorplan-top">
        <SceneNavigator
          mode="compact"
          scenes={scenes}
          activeSceneId={activeSceneId}
          onActiveSceneChange={onActiveSceneChange}
          onAddScene={onAddScene}
          onRenameScene={onRenameScene}
        />
      </header>

      <div className="floorplan-main-tools" role="toolbar" aria-label="Alat Floorplan">
        <div className="floorplan-tool-group">
          <button className={'floorplan-tool-button' + (tool === 'select' ? ' active' : '')} onClick={() => setTool('select')} title="Pilih dan pindahkan" aria-label="Pilih dan pindahkan" aria-pressed={tool === 'select'}>
            <MousePointer2 size={19} />
          </button>
          <button className={'floorplan-tool-button' + (tool === 'pan' ? ' active' : '')} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')} title="Geser tampilan kanvas" aria-label="Geser tampilan kanvas" aria-pressed={tool === 'pan'}>
            <Hand size={18} /><span>Geser kanvas</span>
          </button>
          <button className={'floorplan-tool-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')} title="Gambar jalur gerak aktor atau kamera terpilih" aria-label="Gambar jalur gerak" aria-pressed={tool === 'path'} disabled={!selectedCanHavePath}>
            <Route size={19} /><span>Jalur</span>
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-structure-group" role="group" aria-label="Struktur">
          <span className="floorplan-structure-label">Struktur</span>
          <button className={'floorplan-tool-button' + (tool === 'room' ? ' active' : '')} onClick={() => setTool('room')} title="Gambar ruang dengan drag" aria-label="Gambar ruang" aria-pressed={tool === 'room'}>
            <Square size={18} /><span>Ruang</span>
          </button>
          <button className={'floorplan-tool-button' + (tool === 'wall' ? ' active' : '')} onClick={() => setTool('wall')} title="Gambar dinding dengan menggeser kedua ujungnya" aria-label="Gambar dinding" aria-pressed={tool === 'wall'}>
            <Minus size={19} /><span>Dinding</span>
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-tool-group">
          <button className="floorplan-tool-button" onClick={() => addObject('actor')} title="Tambah aktor" aria-label="Tambah aktor">
            <FloorplanObjectIcon type="actor" size={22} /><span>Aktor</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('camera')} title="Tambah kamera dan hubungkan ke shot" aria-label="Tambah kamera">
            <FloorplanObjectIcon type="camera" size={22} /><span>Camera</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('prop')} title="Tambah properti atau furnitur" aria-label="Tambah properti">
            <FloorplanObjectIcon type="prop" size={22} /><span>Properti</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('light')} title="Tambah lampu" aria-label="Tambah lampu">
            <FloorplanObjectIcon type="light" size={22} /><span>Lampu</span>
          </button>
        </div>
        <span className="floorplan-tool-spacer" />
        <button className="floorplan-icon-button floorplan-clear-button" onClick={clearLayout} title="Kosongkan layout scene ini" aria-label="Kosongkan layout scene ini">
          <Trash2 size={17} />
        </button>
      </div>

      <div className="floorplan-editor">
        <div className="floorplan-canvas-column">
          <div className="floorplan-canvas-frame">
            <svg
              ref={svgRef}
              className={'floorplan-canvas' + (tool === 'select' ? ' can-select' : tool === 'pan' ? ' can-pan' : ' can-draw')}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Kanvas Floorplan tampak atas"
              onPointerDown={handleCanvasPointerDown}
              onClick={handleCanvasClick}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            >
              <defs>
                <marker id="floorplan-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="var(--text-muted)" />
                </marker>
              </defs>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="var(--bg)" />

              {layout.rooms.map(room => {
                const openings = room.openings || []
                const active = selected?.type === 'room' && selected.id === room.id
                const edgeDefs = [
                  { side: 'top', x: room.x, y: room.y, length: room.width, horizontal: true },
                  { side: 'right', x: room.x + room.width, y: room.y, length: room.height, horizontal: false },
                  { side: 'bottom', x: room.x, y: room.y + room.height, length: room.width, horizontal: true },
                  { side: 'left', x: room.x, y: room.y, length: room.height, horizontal: false },
                ]
                return (
                  <g key={room.id} data-floorplan-object="true" onPointerDown={event => beginObjectDrag('room', room, event)} onClick={event => event.stopPropagation()}>
                    <rect
                      x={room.x} y={room.y} width={room.width} height={room.height}
                      fill={active ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
                      stroke="none"
                    />
                    {edgeDefs.flatMap(edge => {
                      const edgeOpenings = openings.filter(opening => (opening.side || 'bottom') === edge.side)
                      return getOpeningSegments(edge.length, edgeOpenings).map((segment, index) => (
                        <line
                          key={edge.side + '-' + index}
                          x1={edge.horizontal ? room.x + segment.start : edge.x}
                          y1={edge.horizontal ? edge.y : room.y + segment.start}
                          x2={edge.horizontal ? room.x + segment.end : edge.x}
                          y2={edge.horizontal ? edge.y : room.y + segment.end}
                          stroke={active ? 'var(--text)' : 'var(--border-strong)'}
                          strokeWidth={active ? 3.5 : 2.5}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      ))
                    })}
                    <text x={room.x + 12} y={room.y + 28} fill="var(--text)" fontSize="18" fontWeight="600" pointerEvents="none">
                      {room.label || 'Room'}
                    </text>
                    {openings.map(opening => {
                      const placement = getRoomOpeningPlacement(room, opening)
                      const openingWidth = Math.min(Number(opening.width) || 48, placement.length)
                      return (
                        <g
                          key={opening.id}
                          transform={'translate(' + placement.x + ' ' + placement.y + ') rotate(' + placement.angle + ')'}
                          data-floorplan-object="true"
                          style={{ cursor: 'grab' }}
                          onPointerDown={event => beginOpeningDrag('room', room, opening, event)}
                          onClick={event => event.stopPropagation()}
                        >
                          {opening.type === 'door' ? (
                            <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' 0 V ' + (-openingWidth)} />
                              <path d={'M ' + (-openingWidth / 2) + ' ' + (-openingWidth) + ' A ' + openingWidth + ' ' + openingWidth + ' 0 0 1 ' + (openingWidth / 2) + ' 0'} strokeDasharray="4 3" strokeOpacity="0.7" />
                            </g>
                          ) : (
                            <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' -4 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 0 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 4 H ' + (openingWidth / 2)} />
                              <path d={'M ' + (-openingWidth / 2) + ' -7 V 7 M ' + (openingWidth / 2) + ' -7 V 7'} />
                            </g>
                          )}
                        </g>
                      )
                    })}
                    {active && RESIZE_HANDLES.map(handle => (
                      <rect
                        key={handle.key}
                        x={(handle.sx < 0 ? room.x : room.x + room.width) - 5}
                        y={(handle.sy < 0 ? room.y : room.y + room.height) - 5}
                        width="10"
                        height="10"
                        rx="1.5"
                        fill="var(--bg)"
                        stroke="var(--text)"
                        strokeWidth="1.8"
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: handle.cursor }}
                        onPointerDown={event => beginResize('room', room, handle.sx, handle.sy, event)}
                      />
                    ))}
                  </g>
                )
              })}

              {layout.walls.map(wall => {
                const metrics = getWallMetrics(wall)
                const length = metrics.length
                const openings = wall.openings || []
                const active = selected?.type === 'wall' && selected.id === wall.id
                const wallAngle = metrics.angle
                return (
                  <g key={wall.id} data-floorplan-object="true" onPointerDown={event => beginObjectDrag('wall', wall, event)} onClick={event => event.stopPropagation()}>
                    {getOpeningSegments(length, openings).map((segment, index) => (
                      <line
                        key={'wall-segment-' + index}
                        x1={wall.x1 + metrics.ux * segment.start}
                        y1={wall.y1 + metrics.uy * segment.start}
                        x2={wall.x1 + metrics.ux * segment.end}
                        y2={wall.y1 + metrics.uy * segment.end}
                        stroke={active ? 'var(--text)' : 'var(--border-strong)'}
                        strokeWidth={active ? (wall.thickness || 6) + 2 : (wall.thickness || 6)}
                        strokeLinecap="square"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                      stroke="transparent" strokeWidth="20" vectorEffect="non-scaling-stroke" />
                    {openings.map(opening => {
                      const center = clamp(opening.offset, 0, 1) * length
                      const openingWidth = Math.min(Number(opening.width) || 48, length)
                      return (
                        <g
                          key={opening.id}
                          transform={'translate(' + (wall.x1 + metrics.ux * center) + ' ' + (wall.y1 + metrics.uy * center) + ') rotate(' + wallAngle + ')'}
                          data-floorplan-object="true"
                          style={{ cursor: 'grab' }}
                          onPointerDown={event => beginOpeningDrag('wall', wall, opening, event)}
                          onClick={event => event.stopPropagation()}
                        >
                          {opening.type === 'door' ? (
                            <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' 0 V ' + (-openingWidth)} />
                              <path d={'M ' + (-openingWidth / 2) + ' ' + (-openingWidth) + ' A ' + openingWidth + ' ' + openingWidth + ' 0 0 1 ' + (openingWidth / 2) + ' 0'} strokeDasharray="4 3" strokeOpacity="0.7" />
                            </g>
                          ) : (
                            <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' -4 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 0 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 4 H ' + (openingWidth / 2)} />
                              <path d={'M ' + (-openingWidth / 2) + ' -7 V 7 M ' + (openingWidth / 2) + ' -7 V 7'} />
                            </g>
                          )}
                        </g>
                      )
                    })}
                    {active && (
                      <>
                        <circle cx={wall.x1} cy={wall.y1} r="6" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} onPointerDown={event => beginWallEndpointDrag(wall, 'start', event)} />
                        <circle cx={wall.x2} cy={wall.y2} r="6" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} onPointerDown={event => beginWallEndpointDrag(wall, 'end', event)} />
                      </>
                    )}
                  </g>
                )
              })}

              {layout.lights.map(light => (
                <g
                  key={'light-cone-' + light.id}
                  transform={'translate(' + light.x + ' ' + light.y + ') rotate(' + (90 + (light.angle || 0)) + ')'}
                  pointerEvents="none"
                >
                  <path
                    d={lightConeSectorPath()}
                    fill="var(--text-muted)"
                    fillOpacity={selected?.type === 'light' && selected.id === light.id ? 0.16 : 0.09}
                    stroke="var(--text-muted)"
                    strokeOpacity={selected?.type === 'light' && selected.id === light.id ? 0.7 : 0.4}
                    strokeWidth={selected?.type === 'light' && selected.id === light.id ? 1.6 : 1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}

              {[
                ...layout.props.map(item => ({ ...item, _kind: 'prop' })),
                ...layout.actors.map(item => ({ ...item, _kind: 'actor' })),
                ...layout.cameras.map(item => ({ ...item, _kind: 'camera' })),
                ...layout.lights.map(item => ({ ...item, _kind: 'light' })),
              ].map(object => {
                const type = object._kind
                const active = selected?.type === type && selected.id === object.id
                const shot = type === 'camera' ? scene.shots.find(item => item.id === object.shotId) : null
                const focalRange = type === 'camera' ? parseFocalLengthRange(shot?.lens) : null
                const cameraFov = focalRange ? {
                  widePath: fovSectorPath(horizontalFovDegrees(focalRange.min)),
                  narrowPath: focalRange.max > focalRange.min
                    ? fovSectorPath(horizontalFovDegrees(focalRange.max))
                    : null,
                } : null
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
                  <g key={type + '-' + object.id} data-floorplan-object="true" onClick={event => event.stopPropagation()}>
                    {points.length > 1 && (
                      <polyline points={pointString} fill="none" stroke={active ? 'var(--text)' : 'var(--text-muted)'} strokeOpacity={active ? 0.95 : 0.3} strokeWidth={active ? 3 : 2} strokeDasharray={active ? '9 6' : '5 9'} markerEnd="url(#floorplan-arrow)" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    )}
                    {(showPath ? (object.path || []) : []).map((point, index) => {
                      const pointSelected = selectedWaypoint?.type === type
                        && selectedWaypoint.id === object.id
                        && selectedWaypoint.index === index
                      return (
                        <circle
                          key={index}
                          data-floorplan-waypoint="true"
                          cx={point.x}
                          cy={point.y}
                          r={pointSelected ? 8 : active ? 6 : 4}
                          fill={pointSelected ? 'var(--text)' : 'var(--bg)'}
                          stroke="var(--text)"
                          strokeOpacity={active ? 1 : 0.55}
                          strokeWidth={pointSelected ? 2.5 : 2}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: 'grab' }}
                          onPointerDown={event => beginWaypointDrag(type, object, index, event)}
                          onClick={event => event.stopPropagation()}
                        />
                      )
                    })}
                    <g
                      transform={'translate(' + object.x + ' ' + object.y + ')'}
                      onPointerDown={event => beginObjectDrag(type, object, event)}
                      style={{ cursor: 'grab' }}
                    >
                      <rect
                        x={['door', 'window', 'prop'].includes(type) ? -(Number(object.width) || 48) / 2 : type === 'actor' ? -36 : type === 'camera' ? -36 : -25}
                        y={['door', 'window', 'prop'].includes(type) ? -(Number(object.height) || 32) / 2 : type === 'actor' ? -30 : type === 'camera' ? -25 : -24}
                        width={['door', 'window', 'prop'].includes(type) ? Math.max(48, Number(object.width) || 48) : type === 'actor' ? 72 : type === 'camera' ? 74 : 50}
                        height={['door', 'window', 'prop'].includes(type) ? Math.max(38, Number(object.height) || 32) : type === 'actor' ? 80 : type === 'camera' ? 78 : 62}
                        fill="transparent"
                        pointerEvents="all"
                      />
                      {type === 'camera' && cameraFov && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                          <path
                            d={cameraFov.widePath}
                            fill="var(--text-muted)"
                            fillOpacity={active ? 0.16 : 0.09}
                            stroke="var(--text-muted)"
                            strokeOpacity={active ? 0.7 : 0.42}
                            strokeWidth={active ? 1.6 : 1.2}
                            vectorEffect="non-scaling-stroke"
                          />
                          {cameraFov.narrowPath && (
                            <path
                              d={cameraFov.narrowPath}
                              fill="var(--bg)"
                              fillOpacity="0.28"
                              stroke="var(--text-muted)"
                              strokeOpacity={active ? 0.8 : 0.48}
                              strokeWidth="1.2"
                              strokeDasharray="5 4"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </g>
                      )}
                      {type === 'camera' && (
                        <g transform={'rotate(' + (object.angle || 0) + ') scale(0.78)'} pointerEvents="none">
                          <path d="M9 -9 L33 -20 L33 20 L9 9 Z" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                          <rect x="-29" y="-15" width="40" height="30" rx="6" fill="var(--bg)" stroke="var(--text)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                        </g>
                      )}
                      {type === 'camera' && (panLeft || panRight || panBoth) && (
                        <g
                          transform={'rotate(' + (object.angle || 0) + ')'}
                          stroke="var(--text-muted)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          fill="none"
                          pointerEvents="none"
                        >
                          {panBoth || (panLeft && panRight) ? (
                            <path
                              d="M 31 22 C 56 22 64 -2 51 -19"
                              markerStart="url(#floorplan-arrow)"
                              markerEnd="url(#floorplan-arrow)"
                            />
                          ) : panLeft ? (
                            <path d="M 55 22 C 64 4 59 -9 49 -19" markerEnd="url(#floorplan-arrow)" />
                          ) : (
                            <path d="M 49 -19 C 59 -9 64 4 55 22" markerEnd="url(#floorplan-arrow)" />
                          )}
                        </g>
                      )}
                      {type === 'door' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                          <path d={'M ' + (-object.width / 2) + ' 0 H ' + (object.width / 2)} strokeWidth="5" />
                          <path d={'M ' + (-object.width / 2) + ' 0 V ' + (-object.width) + ' A ' + object.width + ' ' + object.width + ' 0 0 1 ' + (object.width / 2) + ' 0'} strokeDasharray="4 4" strokeOpacity="0.72" />
                          <path d={'M ' + (-object.width / 2) + ' 0 L ' + (-object.width / 2) + ' ' + (-object.width)} />
                        </g>
                      )}
                      {type === 'window' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none" fill="none" stroke="var(--text)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                          <path d={'M ' + (-object.width / 2) + ' ' + (-Math.max(5, object.height / 2)) + ' H ' + (object.width / 2) + ' M ' + (-object.width / 2) + ' 0 H ' + (object.width / 2) + ' M ' + (-object.width / 2) + ' ' + Math.max(5, object.height / 2) + ' H ' + (object.width / 2)} />
                          <path d={'M ' + (-object.width / 2) + ' ' + (-Math.max(5, object.height / 2) - 3) + ' V ' + (Math.max(5, object.height / 2) + 3) + ' M ' + (object.width / 2) + ' ' + (-Math.max(5, object.height / 2) - 3) + ' V ' + (Math.max(5, object.height / 2) + 3)} />
                        </g>
                      )}
                      {type === 'prop' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none" fill="var(--bg-subtle)" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                          <rect x={-object.width / 2} y={-object.height / 2} width={object.width} height={object.height} rx={object.propType === 'Sofa' ? 8 : 2} />
                          {object.propType === 'Chair' ? (
                            <path d={'M ' + (-object.width * 0.32) + ' ' + (-object.height * 0.25) + ' H ' + (object.width * 0.32) + ' V ' + (object.height * 0.28)} fill="none" />
                          ) : object.propType === 'Bed' ? (
                            <path d={'M ' + (-object.width / 2 + 4) + ' ' + (-object.height / 2 + 9) + ' H ' + (object.width / 2 - 4)} fill="none" />
                          ) : object.propType === 'Sofa' ? (
                            <path d={'M ' + (-object.width / 2 + 5) + ' ' + (-object.height / 2 + 6) + ' H ' + (object.width / 2 - 5) + ' V ' + (object.height / 2 - 6) + ' H ' + (-object.width / 2 + 5) + ' Z'} fill="none" />
                          ) : (
                            <path d={'M ' + (-object.width * 0.32) + ' 0 H ' + (object.width * 0.32) + ' M 0 ' + (-object.height * 0.3) + ' V ' + (object.height * 0.3)} fill="none" />
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
                        <g
                          transform={'rotate(' + (90 + (object.angle || 0)) + ')'}
                          pointerEvents="none"
                          fill="var(--bg)"
                          stroke="var(--text)"
                          strokeWidth="2.5"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        >
                          <path d="M-13 -8 L-8 -11 L3 -11 L11 -7 L11 7 L3 11 L-8 11 L-13 8 Z" />
                          <path d="M-13 -5 L-18 -9 M-13 5 L-18 9" fill="none" strokeLinecap="round" />
                          <circle cx="7" cy="0" r="4.2" fill="var(--text)" stroke="none" />
                          <path d="M-2 -6 L-2 6" strokeOpacity="0.65" fill="none" />
                        </g>
                      )}
                      {active && ['door', 'window', 'prop'].includes(type) ? (
                        <rect
                          x={-object.width / 2 - 5}
                          y={-object.height / 2 - 5}
                          width={object.width + 10}
                          height={object.height + 10}
                          rx="3"
                          fill="none"
                          stroke="var(--text-muted)"
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      ) : active ? (
                        <circle cx="0" cy="0" r="34" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      ) : null}
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
                      {['door', 'window', 'prop'].includes(type) && (
                        <text
                          x="0"
                          y={Math.max(22, Number(object.height) / 2 + 15)}
                          textAnchor="middle"
                          fontSize="13"
                          fontWeight="500"
                          fill="var(--text)"
                          stroke="var(--bg)"
                          strokeWidth="4"
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {type === 'prop' ? (object.propType || 'Prop') : (object.label || (type === 'door' ? 'Door' : 'Window'))}
                        </text>
                      )}
                    </g>

                    {active && ['door', 'window', 'prop'].includes(type) && (
                      <g transform={'translate(' + object.x + ' ' + object.y + ') rotate(' + (object.angle || 0) + ')'}>
                        {RESIZE_HANDLES.map(handle => (
                          <rect
                            key={handle.key}
                            x={handle.sx * object.width / 2 - 5}
                            y={handle.sy * object.height / 2 - 5}
                            width="10"
                            height="10"
                            rx="1.5"
                            fill="var(--bg)"
                            stroke="var(--text)"
                            strokeWidth="1.8"
                            vectorEffect="non-scaling-stroke"
                            style={{ cursor: handle.cursor }}
                            onPointerDown={event => beginResize(type, object, handle.sx, handle.sy, event)}
                          />
                        ))}
                      </g>
                    )}
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
            <div className="floorplan-view-controls" role="group" aria-label="Kontrol tampilan denah">
              <button type="button" className="floorplan-view-control-button" onClick={() => zoomCanvas(1.25)} disabled={viewBox.width >= MAP_WIDTH} title="Perkecil tampilan" aria-label="Perkecil tampilan"><Minus size={16} /></button>
              <span className="floorplan-zoom-level" aria-live="polite">{Math.round((MAP_WIDTH / viewBox.width) * 100)}%</span>
              <button type="button" className="floorplan-view-control-button" onClick={() => zoomCanvas(0.8)} disabled={viewBox.width <= 220} title="Perbesar tampilan" aria-label="Perbesar tampilan"><Plus size={16} /></button>
              <span className="floorplan-view-control-divider" />
              <button type="button" className="floorplan-view-control-button floorplan-fit-button" onClick={fitCanvas} title="Muat seluruh denah ke kanvas" aria-label="Muat seluruh denah ke kanvas"><Maximize2 size={15} /><span>Muat denah</span></button>
            </div>
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
                <button className="floorplan-icon-button danger" onClick={deleteSelected} aria-label="Hapus objek terpilih" title="Hapus objek terpilih"><Trash2 size={17} /></button>
              </div>

              {selectedType === 'actor' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="actor-name">Aktor</label>
                    <input id="actor-name" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Jalur gerak</div>
                    <button className={'floorplan-path-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')}>
                      <Route size={17} /> {tool === 'path' ? 'Selesai menggambar' : 'Gambar jalur'} <span>{selectedPath.length}</span>
                    </button>
                    {selectedWaypoint?.type === selectedType && selectedWaypoint?.id === selectedEntity.id && (
                      <button className="floorplan-remove-point" onClick={deleteSelectedWaypoint}>
                        <Trash2 size={14} /> Remove selected point
                      </button>
                    )}
                    {selectedPath.length > 0 && (
                      <button className="floorplan-remove-path" onClick={() => updateSelected({ path: [] })}>Hapus seluruh jalur</button>
                    )}
                  </section>
                </>
              )}

              {selectedType === 'camera' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="camera-linked-shot">Tautan Shot List</label>
                    <select
                      id="camera-linked-shot"
                      className="floorplan-field"
                      value={selectedEntity.shotId || ''}
                      onChange={event => changeCameraLink(selectedEntity, event.target.value)}
                    >
                      <option value="">Belum ditautkan</option>
                      {scene.shots.filter(shot => !layout.cameras.some(camera => camera.id !== selectedEntity.id && camera.shotId === shot.id)).map(shot => (
                        <option key={shot.id} value={shot.id}>{shot.num} — {shot.subject || 'Untitled shot'}</option>
                      ))}
                    </select>
                  </section>
                  {selectedShot ? (
                    <>
                      <section className="floorplan-inspector-section floorplan-camera-fields">
                        <label htmlFor="camera-subject">Subjek</label>
                        <input
                          id="camera-subject"
                          className="floorplan-field"
                          value={selectedShot.subject || ''}
                          maxLength={1000}
                          onChange={event => updateLinkedShot('subject', event.target.value)}
                          placeholder="Subjek shot"
                        />
                        <label htmlFor="camera-body">Kamera</label>
                        <input
                          id="camera-body"
                          className="floorplan-field"
                          value={selectedShot.camera || ''}
                          maxLength={200}
                          onChange={event => updateLinkedShot('camera', event.target.value)}
                          placeholder="Body kamera"
                        />
                        <label htmlFor="camera-shot-size">Ukuran shot</label>
                        <select
                          id="camera-shot-size"
                          className="floorplan-field"
                          value={selectedShot.size || ''}
                          onChange={event => updateLinkedShot('size', event.target.value)}
                        >
                          <option value="">Pilih ukuran shot</option>
                          {SHOT_SIZES.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <label htmlFor="camera-angle">Angle</label>
                        <select
                          id="camera-angle"
                          className="floorplan-field"
                          value={selectedShot.angle || ''}
                          onChange={event => updateLinkedShot('angle', event.target.value)}
                        >
                          <option value="">Pilih angle</option>
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
                          placeholder="Pilih atau ketik panjang fokus"
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
                          aria-label="Tambah camera movement"
                          value=""
                          onChange={event => addShotListItem('movements', event.target.value)}
                        >
                          <option value="">+ Tambah movement</option>
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
                          aria-label="Tambah equipment kamera"
                          value=""
                          onChange={event => addShotListItem('equipment', event.target.value)}
                        >
                          <option value="">+ Tambah equipment</option>
                          {SHOT_EQUIPMENT.filter(item => !(selectedShot.equipment || []).includes(item)).map(item => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </section>

                      {selectedCameraCanHavePath && (
                        <section className="floorplan-inspector-section">
                          <label>Jalur gerak (opsional)</label>
                          <button className={'floorplan-path-button' + (tool === 'path' ? ' active' : '')} onClick={() => setTool(tool === 'path' ? 'select' : 'path')}>
                            <Route size={17} /> {tool === 'path' ? 'Selesai menggambar' : 'Gambar jalur'} <span>{selectedPath.length}</span>
                          </button>
                          {selectedWaypoint?.type === selectedType && selectedWaypoint?.id === selectedEntity.id && (
                            <button className="floorplan-remove-point" onClick={deleteSelectedWaypoint}>
                              <Trash2 size={14} /> Remove selected point
                            </button>
                          )}
                          {selectedPath.length > 0 && (
                            <button className="floorplan-remove-path" onClick={() => updateSelected({ path: [] })}>Hapus seluruh jalur</button>
                          )}
                        </section>
                      )}
                    </>
                  ) : (
                    <div className="floorplan-inspector-section floorplan-unlinked">
                      <strong>Camera belum ditautkan ke shot.</strong>
                      <span>Pilih shot di atas untuk menyunting data bersama di Shot List.</span>
                    </div>
                  )}
                </>
              )}{selectedType === 'light' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="light-type">Tipe lampu</label>
                  <select id="light-type" className="floorplan-field" value={selectedEntity.lightType || 'Key'} onChange={event => updateSelected({ lightType: event.target.value })}>
                    {LIGHT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </section>
              )}

              {selectedType === 'room' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="room-label">Nama ruang</label>
                    <input id="room-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Dimensi</div>
                    <div className="floorplan-dimension-summary">
                      <div><span>Panjang</span><strong>{formatMeters(selectedEntity.width)}</strong></div>
                      <div><span>Lebar</span><strong>{formatMeters(selectedEntity.height)}</strong></div>
                    </div>
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Bukaan</div>
                    <div className="floorplan-opening-actions">
                      <button className="floorplan-opening-add" onClick={() => addOpening('door')}><FloorplanObjectIcon type="door" size={18} /> Tambah pintu</button>
                      <button className="floorplan-opening-add" onClick={() => addOpening('window')}><FloorplanObjectIcon type="window" size={18} /> Tambah jendela</button>
                    </div>
                    {(selectedEntity.openings || []).map(opening => (
                      <div className="floorplan-opening-row" key={opening.id}>
                        <span className="floorplan-opening-kind"><FloorplanObjectIcon type={opening.type} size={18} />{opening.type === 'door' ? 'Door' : 'Window'}</span>
                        <span className="floorplan-opening-hint">Geser untuk memindahkan</span>
                        <button className="floorplan-icon-button" onClick={() => removeOpening(opening.id)} title="Hapus bukaan" aria-label="Hapus bukaan"><X size={15} /></button>
                      </div>
                    ))}
                  </section>
                </>
              )}

              {selectedType === 'wall' && (
                <>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Dimensi</div>
                    <div className="floorplan-dimension-summary">
                      <div><span>Panjang</span><strong>{formatMeters(getWallMetrics(selectedEntity).length)}</strong></div>
                      <div><span>Lebar</span><strong>{formatMeters(Number(selectedEntity.thickness) || 6)}</strong></div>
                    </div>
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Bukaan</div>
                    <div className="floorplan-opening-actions">
                      <button className="floorplan-opening-add" onClick={() => addOpening('door')}><FloorplanObjectIcon type="door" size={18} /> Tambah pintu</button>
                      <button className="floorplan-opening-add" onClick={() => addOpening('window')}><FloorplanObjectIcon type="window" size={18} /> Tambah jendela</button>
                    </div>
                    {(selectedEntity.openings || []).map(opening => (
                      <div className="floorplan-opening-row" key={opening.id}>
                        <span className="floorplan-opening-kind"><FloorplanObjectIcon type={opening.type} size={18} />{opening.type === 'door' ? 'Door' : 'Window'}</span>
                        <span className="floorplan-opening-hint">Geser di kanvas untuk memindahkan</span>
                        <button className="floorplan-icon-button" onClick={() => removeOpening(opening.id)} title="Hapus bukaan" aria-label="Hapus bukaan"><X size={15} /></button>
                      </div>
                    ))}
                  </section>
                </>
              )}

              {selectedType === 'prop' && (
                <section className="floorplan-inspector-section">
                  <label htmlFor="prop-type">Tipe properti</label>
                  <select id="prop-type" className="floorplan-field" value={selectedEntity.propType || 'Custom'} onChange={event => updateSelected({ propType: event.target.value, label: event.target.value })}>
                    {PROP_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </section>
              )}
            </>
          ) : (
            <div className="floorplan-object-browser">
              <div className="floorplan-object-browser-head">
                <strong>Objek</strong><span>{objectCount}</span>
              </div>
              {allObjects.length === 0 ? (
                <div className="floorplan-empty-state"><Layers2 size={24} /><span>Belum ada objek</span></div>
              ) : (
                allObjects.map(object => (
                  <button key={object.entityType + object.id} className="floorplan-object-row" onClick={() => { setSelected({ type: object.entityType, id: object.id }); onSelectedShotIdChange?.(object.entityType === 'camera' ? (object.shotId || '') : '') }}>
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
