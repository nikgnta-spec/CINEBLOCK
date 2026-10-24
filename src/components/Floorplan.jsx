import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Hand, Square, Minus, Route, Trash2, Plus, Layers2, X, Maximize2, Undo2, Redo2, Lock, Unlock, Ruler, Tag, RotateCcw, RotateCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import SceneNavigator from './SceneNavigator'
import { projectPointToSegment, snapRoomPoint } from '../utils/roomSnapping'
import { createRoomPolygon, connectWallGeometry, updateRoomPolygonGeometry, updateWallEndpointGeometry } from '../utils/floorplanGeometry'
import { findRoomMergeCandidate, mergeAdjacentRoomPolygons, snapRoomToEdge } from '../utils/roomMerge'
import { rotateObjectGroup } from '../utils/objectTransforms'
import { removeReusableRoomRecords, removeReusableRoomReferences } from '../utils/reusableRooms'
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
const TOUCH_ZOOM_SENSITIVITY = 1.3 * 1.5
const EMPTY_LAYOUT = { rooms: [], walls: [], props: [], actors: [], cameras: [], lights: [] }

function cloneLayoutSnapshot(layout) {
  return JSON.parse(JSON.stringify(layout || EMPTY_LAYOUT))
}

function sameLayoutSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getFittedViewBox(layout) {
  const points = []
  const addPoint = (x, y) => {
    const px = Number(x)
    const py = Number(y)
    if (Number.isFinite(px) && Number.isFinite(py)) points.push({ x: px, y: py })
  }

  ;(layout.rooms || []).forEach(room => {
    getRoomPoints(room).forEach(point => addPoint(point.x, point.y))
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

  const minX = Math.min(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxX = Math.max(...points.map(point => point.x))
  const maxY = Math.max(...points.map(point => point.y))
  const contentWidth = Math.max(220, maxX - minX)
  const contentHeight = Math.max(143, maxY - minY)

  // Keep the complete drawing comfortably inside the visible canvas.
  const padding = Math.max(64, Math.max(contentWidth, contentHeight) * 0.16)
  const mapAspect = MAP_WIDTH / MAP_HEIGHT
  let width = contentWidth + padding * 2
  let height = contentHeight + padding * 2
  if (width / height < mapAspect) width = height * mapAspect
  else height = width / mapAspect

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}
const RESIZE_HANDLES = [
  { key: 'nw', sx: -1, sy: -1, cursor: 'nwse-resize' },
  { key: 'ne', sx: 1, sy: -1, cursor: 'nesw-resize' },
  { key: 'sw', sx: -1, sy: 1, cursor: 'nesw-resize' },
  { key: 'se', sx: 1, sy: 1, cursor: 'nwse-resize' },
]
const getRoomPoints = room => Array.isArray(room?.points) && room.points.length >= 3
  ? room.points
  : [{ x: room.x, y: room.y }, { x: room.x + room.width, y: room.y }, { x: room.x + room.width, y: room.y + room.height }, { x: room.x, y: room.y + room.height }]
const getRoomBounds = room => {
  const points = getRoomPoints(room)
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
const resizeRoomBounds = (room, dimension, targetUnits) => {
  const points = getRoomPoints(room)
  const bounds = getRoomBounds(room)
  const current = dimension === 'length' ? bounds.width : bounds.height
  if (!Number.isFinite(targetUnits) || targetUnits <= 0 || current <= 0) return room
  const scale = targetUnits / current
  const nextPoints = points.map(point => dimension === 'length'
    ? { x: Math.round(bounds.x + (point.x - bounds.x) * scale), y: point.y }
    : { x: point.x, y: Math.round(bounds.y + (point.y - bounds.y) * scale) })
  return { ...room, points: nextPoints }
}
const getRoomEdges = room => getRoomPoints(room).map((point, index, points) => {
  const next = points[(index + 1) % points.length]
  const dx = next.x - point.x
  const dy = next.y - point.y
  return { edgeIndex: index, x1: point.x, y1: point.y, x2: next.x, y2: next.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI }
})
const getRoomDimensionGeometry = (room, edge) => {
  const points = getRoomPoints(room)
  const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1
  const length = Math.hypot(dx, dy) || 1
  let nx = dy / length, ny = -dx / length
  const midpoint = { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 }
  // For concave polygons, centroid-based normals can point into the room.
  // Probe both sides of the edge and choose the side outside the polygon.
  const probeDistance = Math.max(2, Math.min(8, length * 0.04))
  const positiveProbe = { x: midpoint.x + nx * probeDistance, y: midpoint.y + ny * probeDistance }
  const negativeProbe = { x: midpoint.x - nx * probeDistance, y: midpoint.y - ny * probeDistance }
  if (pointInPolygon(positiveProbe, points) && !pointInPolygon(negativeProbe, points)) { nx *= -1; ny *= -1 }
  const offset = 72
  // Dimension lines are always axis-aligned. For horizontal-ish edges,
  // draw a horizontal dimension; for vertical-ish edges, draw a vertical one.
  // Keep the measured label based on the actual edge length.
  let x1, y1, x2, y2
  if (Math.abs(dx) >= Math.abs(dy)) {
    const guideY = midpoint.y + ny * offset
    x1 = Math.min(edge.x1, edge.x2)
    x2 = Math.max(edge.x1, edge.x2)
    y1 = y2 = guideY
  } else {
    const guideX = midpoint.x + nx * offset
    y1 = Math.min(edge.y1, edge.y2)
    y2 = Math.max(edge.y1, edge.y2)
    x1 = x2 = guideX
  }
  return { x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, length: edge.length, angle: 0 }
}

// Assign stable, evenly spaced lanes to dimensions that share an exterior side.
// Geometry and measured values remain unchanged; only visual placement is adjusted.
const getRoomDimensionLayouts = (room, edges) => {
  const bounds = getRoomBounds(room)
  // Ignore sub-5-unit sliver edges in dimensions (under 5 cm at 100 units/m).
  // Keep the actual room polygon/wall intact; this only prevents alignment residue labels.
  const prepared = edges.filter(edge => edge.length >= 5).map(edge => {
    const dimension = getRoomDimensionGeometry(room, edge)
    const horizontal = Math.abs(edge.x2 - edge.x1) >= Math.abs(edge.y2 - edge.y1)
    const midpoint = { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 }
    const side = horizontal
      ? (dimension.my < midpoint.y ? 'top' : 'bottom')
      : (dimension.mx < midpoint.x ? 'left' : 'right')
    const sideKey = (horizontal ? 'h-' : 'v-') + side
    const intervalStart = horizontal ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2)
    const intervalEnd = horizontal ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2)
    return { edge, dimension, sideKey, horizontal, side, intervalStart, intervalEnd }
  })
  const groups = new Map()
  prepared.forEach(item => {
    if (!groups.has(item.sideKey)) groups.set(item.sideKey, [])
    groups.get(item.sideKey).push(item)
  })
  for (const group of groups.values()) {
    group.sort((a, b) => a.intervalStart - b.intervalStart || a.edge.edgeIndex - b.edge.edgeIndex)
    const lanes = []
    group.forEach(item => {
      // All dimensions on one exterior side use a shared rectangular baseline.
      // Add another lane only when the projected label ranges would collide.
      // Lane collision is determined by label footprints, not full wall spans.
      // Adjacent wall segments can share one straight dimension row when their labels
      // have enough room, matching conventional floor-plan dimension chains.
      const labelCenter = (item.intervalStart + item.intervalEnd) / 2
      const labelHalfWidth = 30
      const paddedStart = labelCenter - labelHalfWidth
      const paddedEnd = labelCenter + labelHalfWidth
      let level = lanes.findIndex(lane => lane.every(interval => paddedEnd < interval.start || paddedStart > interval.end))
      if (level < 0) level = lanes.length
      if (!lanes[level]) lanes[level] = []
      lanes[level].push({ start: paddedStart, end: paddedEnd })
      const offset = 72 + level * 30
      if (item.horizontal) {
        const baseline = item.side === 'top' ? bounds.y - offset : bounds.y + bounds.height + offset
        item.dimension.x1 = Math.min(item.edge.x1, item.edge.x2)
        item.dimension.x2 = Math.max(item.edge.x1, item.edge.x2)
        item.dimension.y1 = item.dimension.y2 = baseline
        item.dimension.mx = (item.dimension.x1 + item.dimension.x2) / 2
        item.dimension.my = baseline
      } else {
        const baseline = item.side === 'left' ? bounds.x - offset : bounds.x + bounds.width + offset
        item.dimension.y1 = Math.min(item.edge.y1, item.edge.y2)
        item.dimension.y2 = Math.max(item.edge.y1, item.edge.y2)
        item.dimension.x1 = item.dimension.x2 = baseline
        item.dimension.mx = baseline
        item.dimension.my = (item.dimension.y1 + item.dimension.y2) / 2
      }
      item.dimension.x1 = Math.round(item.dimension.x1 * 100) / 100
      item.dimension.x2 = Math.round(item.dimension.x2 * 100) / 100
      item.dimension.y1 = Math.round(item.dimension.y1 * 100) / 100
      item.dimension.y2 = Math.round(item.dimension.y2 * 100) / 100
      item.dimension.level = level
    })
  }
  return prepared
}

const pointInPolygon = (point, points) => {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    if (intersects) inside = !inside
  }
  return inside
}
// Legacy merged Rooms may predate the internalWalls field. Recover a missing
// shared seam from an orthogonal concave corner so existing local projects keep
// showing their internal wall after updating the app.
const getRoomInternalWalls = room => {
  const stored = Array.isArray(room?.internalWalls) ? room.internalWalls.filter(wall =>
    [wall.x1, wall.y1, wall.x2, wall.y2].every(value => Number.isFinite(Number(value)))
      && Math.hypot(Number(wall.x2) - Number(wall.x1), Number(wall.y2) - Number(wall.y1)) > 1
  ) : []
  if (stored.length) return stored
  const points = getRoomPoints(room)
  if (points.length < 4) return []
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0)
  const winding = area >= 0 ? 1 : -1
  const reflex = []
  points.forEach((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]
    const next = points[(index + 1) % points.length]
    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x)
    if (cross * winding < -1) reflex.push(index)
  })
  const walls = []
  const used = new Set()
  for (const reflexIndex of reflex) {
    const corner = points[reflexIndex]
    const candidates = points.map((point, index) => {
      if (index === reflexIndex || (index + 1) % points.length === reflexIndex || (index - 1 + points.length) % points.length === reflexIndex || used.has(index)) return null
      const dx = Math.abs(point.x - corner.x), dy = Math.abs(point.y - corner.y)
      if (Math.min(dx, dy) > 1 || Math.max(dx, dy) < 2) return null
      const midpoint = { x: (point.x + corner.x) / 2, y: (point.y + corner.y) / 2 }
      if (!pointInPolygon(midpoint, points)) return null
      return { index, point, length: Math.hypot(dx, dy) }
    }).filter(Boolean).sort((a, b) => a.length - b.length)
    const candidate = candidates[0]
    if (!candidate) continue
    walls.push({ x1: corner.x, y1: corner.y, x2: candidate.point.x, y2: candidate.point.y, legacyInferred: true })
    used.add(candidate.index)
  }
  return walls
}
const openingLabel = opening => opening.type === 'window' ? 'Jendela' : opening.type === 'doorway' ? (opening.label || 'Pintu Tanpa Daun') : 'Pintu'

const DoorSwingSymbol = ({ opening, width }) => {
  const direction = opening.swingDirection === 'out' ? -1 : 1
  const hingeSide = opening.hingeSide === 'right' ? 'right' : 'left'
  const leafCount = opening.doorType === 'double' ? 2 : 1
  const half = width / 2
  const leaf = width / leafCount
  const swing = Math.max(leaf, 24)
  const hingeX = hingeSide === 'right' ? half : -half
  const freeX = -hingeX
  return <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none">
    {/* Solid stroke = actual door leaf; dashed curve = swing arc. */}
    {leafCount === 1 ? <>
      <path d={'M ' + (-half) + ' 0 H ' + half} />
      <path d={'M ' + hingeX + ' 0 L ' + hingeX + ' ' + (direction * swing)} strokeWidth="3" />
      <path d={'M ' + hingeX + ' ' + (direction * swing) + ' A ' + swing + ' ' + swing + ' 0 0 ' + (hingeSide === 'left' ? (direction < 0 ? 1 : 0) : (direction > 0 ? 1 : 0)) + ' ' + freeX + ' 0'} strokeDasharray="4 3" strokeOpacity="0.7" />
    </> : <>
      <path d={'M ' + (-half) + ' 0 H ' + half} />
      <path d={'M ' + (-half) + ' 0 L ' + (-half) + ' ' + (direction * swing) + ' M ' + half + ' 0 L ' + half + ' ' + (direction * swing)} strokeWidth="3" />
      <path d={'M ' + (-half) + ' ' + (direction * swing) + ' A ' + swing + ' ' + swing + ' 0 0 ' + (direction < 0 ? 1 : 0) + ' 0 0 M ' + half + ' ' + (direction * swing) + ' A ' + swing + ' ' + swing + ' 0 0 ' + (direction > 0 ? 1 : 0) + ' 0 0'} strokeDasharray="4 3" strokeOpacity="0.7" />
    </>}
  </g>
}
const getOpeningSegments = (length, openings = []) => {
  const ranges = openings
    .map(opening => {
      const width = Math.min(Number(opening.width ?? 48), length)
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
  const offset = clamp(opening.offset, 0.05, 0.95)
  if (opening.wallType === 'internal' && Number.isInteger(opening.internalWallIndex)) {
    const wall = getRoomInternalWalls(room)[opening.internalWallIndex]
    if (wall) {
      const metrics = getWallMetrics(wall)
      return {
        x: wall.x1 + metrics.ux * metrics.length * offset,
        y: wall.y1 + metrics.uy * metrics.length * offset,
        angle: metrics.angle + 180,
        length: metrics.length,
        internalWallIndex: opening.internalWallIndex,
      }
    }
  }
  const edges = getRoomEdges(room)
  const edge = edges[Math.max(0, Math.min(edges.length - 1, Number.isInteger(opening.edgeIndex) ? opening.edgeIndex : ({ top: 0, right: 1, bottom: 2, left: 3 }[opening.side] ?? 2)))] || edges[0]
  if (!edge) return { x: 0, y: 0, angle: 0, length: 1, edgeIndex: 0 }
  return {
    x: edge.x1 + (edge.x2 - edge.x1) * offset,
    y: edge.y1 + (edge.y2 - edge.y1) * offset,
    angle: edge.angle + 180,
    length: edge.length,
    edgeIndex: edge.edgeIndex,
  }
}
const getWallMetrics = wall => {
  const dx = wall.x2 - wall.x1
  const dy = wall.y2 - wall.y1
  return { length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI, ux: dx / (Math.hypot(dx, dy) || 1), uy: dy / (Math.hypot(dx, dy) || 1) }
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0))
const formatMeters = value => (Math.max(0, Number(value) || 0) / 100).toFixed(2) + ' m'
// Production-aware colors: function defines the family; stable ID picks an
// instance shade so multiple lights remain distinguishable without random colors.
const LIGHT_COLOR_PALETTES = {
  key: ['#FFD166', '#F5A742', '#E9C46A', '#F28C45'],
  fill: ['#67E8F9', '#22D3EE', '#38BDF8', '#5EEAD4'],
  back: ['#D8B4FE', '#C084FC', '#A78BFA', '#E879F9'],
  practical: ['#86EFAC', '#4ADE80', '#A3E635', '#34D399'],
  ambient: ['#CBD5E1', '#94A3B8', '#A8B7CC', '#7C9AB8'],
  special: ['#FDA4AF', '#FB7185', '#F472B6', '#F9A8D4'],
  default: ['#CBD5E1', '#94A3B8', '#A8B7CC', '#7C9AB8'],
}
const CAMERA_FOV_COLORS = ['#60A5FA', '#38BDF8', '#818CF8', '#7DD3FC']
const CATEGORY_COLORS = {
  actor: '#C084FC',
  prop: '#4ADE80',
  camera: '#60A5FA',
  room: '#94A3B8',
  wall: '#94A3B8',
  door: '#94A3B8',
  window: '#94A3B8',
}
// Spectrum palette offered for actor and camera (incl. FOV cone) colors, so
// multiple actors/cameras in the same scene can be told apart at a glance.
const OBJECT_COLOR_PALETTE = [
  '#F87171', // red
  '#FB923C', // orange
  '#FBBF24', // amber
  '#A3E635', // lime
  '#4ADE80', // green
  '#34D399', // emerald
  '#2DD4BF', // teal
  '#22D3EE', // cyan
  '#60A5FA', // blue
  '#818CF8', // indigo
  '#C084FC', // purple
  '#F472B6', // pink
]
const stableColorIndex = id => {
  const text = String(id || 'default')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
  return hash % 4
}
const getLightConeColors = light => {
  const type = String(light?.lightType || '').toLowerCase()
  const family = type.includes('key') ? 'key'
    : type.includes('fill') ? 'fill'
      : type.includes('back') || type.includes('rim') ? 'back'
        : type.includes('practical') ? 'practical'
          : type.includes('ambient') ? 'ambient'
            : type.includes('special') ? 'special' : 'default'
  const color = LIGHT_COLOR_PALETTES[family][stableColorIndex(light?.id)]
  return { fill: color, stroke: color }
}
const getCameraFovColor = camera => camera?.color || CAMERA_FOV_COLORS[stableColorIndex(camera?.id)]
const getObjectColor = (type, object) => (
  type === 'light' ? getLightConeColors(object).stroke
    : (type === 'actor' || type === 'camera') && object?.color ? object.color
      : CATEGORY_COLORS[type] || '#94A3B8'
)
const makeId = () => crypto.randomUUID()
const padNum = number => String(number).padStart(2, '0')
const normalizeAngle = angle => ((angle % 360) + 360) % 360

function ColorSwatchPicker({ value, onChange, label }) {
  return (
    <div className="floorplan-color-swatches" role="group" aria-label={label}>
      {OBJECT_COLOR_PALETTE.map(color => (
        <button
          key={color}
          type="button"
          className={'floorplan-color-swatch' + (value === color ? ' active' : '')}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
          aria-pressed={value === color}
          aria-label={color}
          title={color}
        />
      ))}
    </div>
  )
}

function FloorplanObjectIcon({ type, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={type === 'camera' ? '-36 -25 72 50' : type === 'light' ? '-26 -28 52 56' : ['door', 'doorway', 'window', 'prop', 'room', 'wall'].includes(type) ? '-26 -22 52 44' : '-50 -42 100 84'}
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
      ) : type === 'doorway' ? (
        <g>
          <path d="M-20 -5 H-8 M8 -5 H20 M-20 5 H-8 M8 5 H20" />
        </g>
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
        <g>          <rect x="-16" y="-12" width="32" height="24" rx="2" />
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
          <rect x="-19" y="-13" width="28" height="26" rx="3" />
          <path d="M-12 -13 L-7 -20 H1 L6 -13" />
          <path d="M9 -8 H16" strokeWidth="4" />
          <circle cx="22" cy="0" r="9" />
          <circle cx="22" cy="0" r="3.5" />
        </g>
      ) : type === 'light' ? (
        <g>
          <path d="M-18 -12 L8 -8 L8 8 L-18 12 Z" />
          <path d="M8 -8 L17 -13 M8 8 L17 13" />
          <path d="M0 8 V18 M-10 21 H10 M0 18 L-10 25 M0 18 L10 25" />
          <path d="M-22 -16 L-18 -12 M-22 16 L-18 12" />
        </g>
      ) : (
        <g>
          <rect x="-16" y="-12" width="32" height="24" rx="2" />
          <path d="M-10 -7 H10 M-10 7 H10" />
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

// World units: 100 units = 1 meter; default light throw is 1.5 m.
const LIGHT_CONE_RADIUS = 45
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

function renumberShots(shots) {
  return shots.map((shot, index) => ({ ...shot, num: String(index + 1).padStart(3, '0') }))
}

export default function Floorplan({
  scenes,
  isActive = true,
  onChange,
  activeSceneId,
  onActiveSceneChange,
  defaultShot,
  onAddScene,
  onRenameScene,
  floorplans,
  onFloorplansChange,
  projectRooms = null,
  onProjectRoomsChange,
  selectedShotId,
  onSelectedShotIdChange,
}) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [selectedWaypoint, setSelectedWaypoint] = useState(null)
  const [selectionBox, setSelectionBox] = useState(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const pinchRef = useRef(null)
  const [drawStart, setDrawStart] = useState(null)
  const [roomDrawPoints, setRoomDrawPoints] = useState([])
  const [roomLengthInputOpen, setRoomLengthInputOpen] = useState(false)
  const [roomLengthInput, setRoomLengthInput] = useState('')
  const [roomManualAngle, setRoomManualAngle] = useState(null)
  const [roomDrawMessage, setRoomDrawMessage] = useState('')
  const [showRoomDimensions, setShowRoomDimensions] = useState(true)
  const [showObjectLabels, setShowObjectLabels] = useState(true)
  const [shotFocusMode, setShotFocusMode] = useState(false)
  const [hoveredRoomEdge, setHoveredRoomEdge] = useState(null)
  const [selectedRoomEdge, setSelectedRoomEdge] = useState(null)
  const [previewPoint, setPreviewPoint] = useState(null)
  const [roomSnapGuides, setRoomSnapGuides] = useState([])
  const [roomMergePrompt, setRoomMergePrompt] = useState(null)
  const [roomVertexPrompt, setRoomVertexPrompt] = useState(null)
  const [selectedRoomVertex, setSelectedRoomVertex] = useState(null)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT })
  const initialLayoutFitRef = useRef(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 520 })
  const selectionRef = useRef([])
  const layoutRef = useRef(null)
  const dragHistoryBeforeRef = useRef(null)
  const historyActionRef = useRef(false)
  const historyRef = useRef({ sceneId: null, past: [], future: [], lastLayout: null })
  // Track shots created as a side effect of adding a camera so Undo/Redo can
  // reverse and restore that paired change together with the floorplan layout.
  const autoCreatedShotsByCameraRef = useRef(new Map())
  const deletedReusableRoomSceneRefsRef = useRef(new Map())

  const scene = scenes.find(item => item.id === activeSceneId) || scenes[0]
  const selectedSceneShotIndex = scene?.shots.findIndex(shot => shot.id === selectedShotId) ?? -1
  const activeFloorplanShotIndex = selectedSceneShotIndex >= 0 ? selectedSceneShotIndex : 0
  const activeFloorplanShot = scene?.shots[activeFloorplanShotIndex] || null
  const moveFloorplanShot = offset => {
    if (!scene?.shots?.length) return
    const nextIndex = Math.max(0, Math.min(scene.shots.length - 1, activeFloorplanShotIndex + offset))
    onSelectedShotIdChange?.(scene.shots[nextIndex].id)
  }
  const storedLayout = scene ? (floorplans?.[scene.id] || EMPTY_LAYOUT) : EMPTY_LAYOUT
  const reusableRoomMode = Array.isArray(projectRooms)
  const layout = scene
    ? { ...storedLayout, rooms: storedLayout.roomIsolationVersion === 1
      ? (storedLayout.rooms || [])
      : reusableRoomMode
        ? projectRooms.filter(room => (scene.roomIds || []).includes(room.id))
        : (storedLayout.rooms || []) }
    : EMPTY_LAYOUT
  layoutRef.current = layout

  useEffect(() => {
    if (initialLayoutFitRef.current || !scene) return
    const hasObjects = ['rooms', 'walls', 'props', 'actors', 'cameras', 'lights']
      .some(collection => (layout[collection] || []).length > 0)
    if (!hasObjects) return

    initialLayoutFitRef.current = true
    const fitted = getFittedViewBox(layout)
    const extendsPastInitialCanvas = fitted.x < 0 || fitted.y < 0
      || fitted.x + fitted.width > MAP_WIDTH || fitted.y + fitted.height > MAP_HEIGHT
    if (extendsPastInitialCanvas) setViewBox(fitted)
  }, [scene?.id, layout])

  const allObjects = [
    ...layout.rooms.map(item => ({ ...item, entityType: 'room' })),
    ...layout.walls.map(item => ({ ...item, entityType: 'wall' })),
    ...layout.props.map(item => ({ ...item, entityType: 'prop' })),
    ...layout.actors.map(item => ({ ...item, entityType: 'actor' })),
    ...layout.cameras.map(item => ({ ...item, entityType: 'camera' })),
    ...layout.lights.map(item => ({ ...item, entityType: 'light' })),
  ]
  useEffect(() => {
    const canvas = svgRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width && height) setCanvasSize({ width, height })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const selectedEntity = selected
    ? (layout[selected.type + 's'] || []).find(item => item.id === selected.id) || null
    : null
  const selectedType = selectedEntity ? selected.type : null
  const canUndo = historyRevision >= 0 && historyRef.current.sceneId === scene?.id && historyRef.current.past.length > 0
  const canRedo = historyRevision >= 0 && historyRef.current.sceneId === scene?.id && historyRef.current.future.length > 0
  const selectedShot = selectedType === 'camera'
    ? scene?.shots.find(shot => shot.id === selectedEntity.shotId) || null
    : null
  const selectedShotMovements = selectedShot?.movements || []
  const selectedCameraCanHavePath = selectedShotMovements.some(movement => CAMERA_PATH_MOVEMENTS.has(movement))
  const selectedCanHavePath = selectedType === 'actor' || (selectedType === 'camera' && selectedCameraCanHavePath)

  useEffect(() => {
    setSelected(null)
    setSelectedItems([])
    selectionRef.current = []
    setSelectedWaypoint(null)
    setSelectionBox(null)
    setTool('select')
    dragRef.current = null
    dragHistoryBeforeRef.current = null
    historyActionRef.current = false
    historyRef.current = {
      sceneId: scene?.id || null,
      past: [],
      future: [],
      lastLayout: cloneLayoutSnapshot(layout),
    }
    setHistoryRevision(value => value + 1)
    setDrawStart(null)
    setRoomDrawPoints([])
    setRoomLengthInputOpen(false)
    setPreviewPoint(null)
    // Keep the user's current zoom and pan when switching scenes.
    // Fitting the canvas remains available through the explicit Fit control.
  }, [scene?.id])

  useEffect(() => {
    if (!scene) return
    const snapshot = cloneLayoutSnapshot(layout)
    let history = historyRef.current
    if (!history || history.sceneId !== scene.id) {
      historyRef.current = { sceneId: scene.id, past: [], future: [], lastLayout: snapshot }
      setHistoryRevision(value => value + 1)
      return
    }
    if (historyActionRef.current) {
      historyActionRef.current = false
      history.lastLayout = snapshot
      setHistoryRevision(value => value + 1)
      return
    }
    if (dragRef.current && dragHistoryBeforeRef.current) {
      history.lastLayout = snapshot
      return
    }
    if (!sameLayoutSnapshot(snapshot, history.lastLayout)) {
      history.past.push(cloneLayoutSnapshot(history.lastLayout))
      if (history.past.length > 50) history.past.shift()
      history.future = []
      history.lastLayout = snapshot
      setHistoryRevision(value => value + 1)
    }
  }, [scene?.id, layout])

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
    if (!linkedCamera) {
      if (selectionRef.current.length <= 1) applyEntitySelection([])
      return
    }
    setSelected({ type: 'camera', id: linkedCamera.id })
    const cameraInGroup = selectionRef.current.some(item => item.type === 'camera' && item.id === linkedCamera.id)
    if (selectionRef.current.length <= 1 || !cameraInGroup) applyEntitySelection([{ type: 'camera', id: linkedCamera.id }])
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
    const stored = floorplans?.[scene.id] || EMPTY_LAYOUT
    const currentLayout = { ...stored, rooms: layoutRef.current?.rooms || [] }
    const nextLayout = updater(currentLayout)
    if (reusableRoomMode) {
      const previousRoomIds = new Set((scene.roomIds || []))
      const nextRoomIds = new Set((nextLayout.rooms || []).map(room => room.id))
      onProjectRoomsChange?.(previous => {
        const current = Array.isArray(previous) ? previous : []
        const byId = new Map(current.map(room => [room.id, room]))
        ;(nextLayout.rooms || []).forEach(room => byId.set(room.id, room))
        return [...byId.values()]
      })
      onChange?.(previous => previous.map(item => item.id !== scene.id ? item : {
        ...item,
        roomIds: [...new Set([...(item.roomIds || []).filter(id => !previousRoomIds.has(id)), ...nextRoomIds])],
      }))
      onFloorplansChange(previous => ({
        ...previous,
        [scene.id]: { ...nextLayout, rooms: [], roomIsolationVersion: undefined },
      }))
      return
    }
    onFloorplansChange(previous => ({ ...previous, [scene.id]: nextLayout }))
  }

  const deleteReusableRooms = roomIds => {
    if (!reusableRoomMode || !roomIds?.size) return
    roomIds.forEach(id => {
      deletedReusableRoomSceneRefsRef.current.set(id, scenes
        .filter(item => item.roomIds?.includes(id))
        .map(item => item.id))
    })
    onProjectRoomsChange?.(previous => removeReusableRoomRecords(previous, roomIds))
    onChange?.(previous => removeReusableRoomReferences(previous, roomIds))
  }

  const restoreReusableRooms = roomIds => {
    if (!reusableRoomMode || !roomIds?.size) return
    const references = new Map([...roomIds]
      .map(id => [id, deletedReusableRoomSceneRefsRef.current.get(id) || []])
      .filter(([, sceneIds]) => sceneIds.length > 0))
    if (!references.size) return
    onChange?.(previous => previous.map(item => {
      const restoredIds = [...references]
        .filter(([, sceneIds]) => sceneIds.includes(item.id))
        .map(([id]) => id)
      if (!restoredIds.length) return item
      return { ...item, roomIds: [...new Set([...(item.roomIds || []), ...restoredIds])] }
    }))
  }

  const applyEntitySelection = (items, primary = null) => {
    const unique = []
    items.forEach(item => {
      if (item && !unique.some(existing => existing.type === item.type && existing.id === item.id)) unique.push(item)
    })
    selectionRef.current = unique
    setSelectedItems(unique)
    const nextPrimary = primary && unique.some(item => item.type === primary.type && item.id === primary.id)
      ? primary
      : unique[unique.length - 1] || null
    setSelected(nextPrimary)
    setSelectedWaypoint(null)
  }

  const selectAllObjects = () => {
    const items = allObjects.map(object => ({ type: object.entityType, id: object.id }))
    applyEntitySelection(items, items[items.length - 1] || null)
  }

  const beginDragHistory = () => {
    dragHistoryBeforeRef.current = cloneLayoutSnapshot(layoutRef.current)
  }

  const finishDragHistory = () => {
    const before = dragHistoryBeforeRef.current
    const after = cloneLayoutSnapshot(layoutRef.current)
    dragHistoryBeforeRef.current = null
    const history = historyRef.current
    if (!before || !history || history.sceneId !== scene?.id) return
    if (sameLayoutSnapshot(before, after)) {
      history.lastLayout = after
      return
    }
    history.past.push(cloneLayoutSnapshot(before))
    if (history.past.length > 50) history.past.shift()
    history.future = []
    history.lastLayout = after
    setHistoryRevision(value => value + 1)
  }

  const undoLayout = () => {
    const history = historyRef.current
    if (!scene || history.sceneId !== scene.id || !history.past.length) return
    const current = cloneLayoutSnapshot(layoutRef.current)
    const previous = history.past.pop()
    history.future.push(current)
    history.lastLayout = cloneLayoutSnapshot(previous)
    historyActionRef.current = true
    setHistoryRevision(value => value + 1)

    // A camera may have created its linked shot automatically. Undoing the
    // camera's creation must also undo that shot creation.
    const currentCameraIds = new Set(current.cameras.map(camera => camera.id))
    const previousCameraIds = new Set(previous.cameras.map(camera => camera.id))
    const shotRecords = [...autoCreatedShotsByCameraRef.current.entries()]
      .filter(([, record]) => record.sceneId === scene.id)
    const autoShotsToRemove = shotRecords
      .filter(([cameraId, record]) => record.autoCreated
        && currentCameraIds.has(cameraId)
        && !previousCameraIds.has(cameraId))
      .map(([, record]) => record.shot.id)
    const deletedShotsToRestore = shotRecords
      .filter(([cameraId, record]) => record.deletedShot
        && !currentCameraIds.has(cameraId)
        && previousCameraIds.has(cameraId))
      .map(([, record]) => record)

    if (autoShotsToRemove.length || deletedShotsToRestore.length) {
      const removedShotIds = new Set(autoShotsToRemove)
      onChange(previousScenes => previousScenes.map(item => {
        if (item.id !== scene.id) return item
        let nextShots = item.shots.filter(shot => !removedShotIds.has(shot.id))
        const existingShotIds = new Set(nextShots.map(shot => shot.id))
        const restoredRecords = deletedShotsToRestore
          .filter(record => !existingShotIds.has(record.shot.id))
          .sort((left, right) => (left.shotIndex ?? Number.MAX_SAFE_INTEGER) - (right.shotIndex ?? Number.MAX_SAFE_INTEGER))
        for (const record of restoredRecords) {
          const index = Number.isInteger(record.shotIndex)
            ? Math.max(0, Math.min(record.shotIndex, nextShots.length))
            : nextShots.length
          nextShots.splice(index, 0, record.shot)
        }
        return { ...item, shots: renumberShots(nextShots) }
      }))
    }

    const currentRoomIds = new Set(current.rooms.map(room => room.id))
    const restoredRoomIds = new Set(previous.rooms.filter(room => !currentRoomIds.has(room.id)).map(room => room.id))
    updateLayout(() => cloneLayoutSnapshot(previous))
    restoreReusableRooms(restoredRoomIds)
    applyEntitySelection([])
    onSelectedShotIdChange?.('')
  }

  const redoLayout = () => {
    const history = historyRef.current
    if (!scene || history.sceneId !== scene.id || !history.future.length) return
    const current = cloneLayoutSnapshot(layoutRef.current)
    const next = history.future.pop()
    history.past.push(current)
    if (history.past.length > 50) history.past.shift()
    history.lastLayout = cloneLayoutSnapshot(next)
    historyActionRef.current = true
    setHistoryRevision(value => value + 1)

    // Redo restores the paired auto-created shot when it restores that camera.
    const currentCameraIds = new Set(current.cameras.map(camera => camera.id))
    const nextCameraIds = new Set(next.cameras.map(camera => camera.id))
    const shotRecords = [...autoCreatedShotsByCameraRef.current.entries()]
      .filter(([, record]) => record.sceneId === scene.id)
    const autoShotsToRestore = shotRecords
      .filter(([cameraId, record]) => record.autoCreated
        && !currentCameraIds.has(cameraId)
        && nextCameraIds.has(cameraId))
      .map(([, record]) => record.shot)
    const deletedShotIdsToRemove = shotRecords
      .filter(([cameraId, record]) => record.deletedShot
        && currentCameraIds.has(cameraId)
        && !nextCameraIds.has(cameraId))
      .map(([, record]) => record.shot.id)
    if (autoShotsToRestore.length || deletedShotIdsToRemove.length) {
      const removedShotIds = new Set(deletedShotIdsToRemove)
      onChange(previousScenes => previousScenes.map(item => {
        if (item.id !== scene.id) return item
        const existingShotIds = new Set(item.shots.map(shot => shot.id))
        const restoredShots = autoShotsToRestore.filter(shot => !existingShotIds.has(shot.id))
        return {
          ...item,
          shots: renumberShots([
            ...item.shots.filter(shot => !removedShotIds.has(shot.id)),
            ...restoredShots,
          ]),
        }
      }))
    }

    const nextRoomIds = new Set(next.rooms.map(room => room.id))
    const removedRoomIds = new Set(current.rooms.filter(room => !nextRoomIds.has(room.id)).map(room => room.id))
    updateLayout(() => cloneLayoutSnapshot(next))
    deleteReusableRooms(removedRoomIds)
    applyEntitySelection([])
    onSelectedShotIdChange?.('')
  }

  const rotateSelectedGroup = degrees => {
    const selected = selectionRef.current.filter(entry => ['prop', 'actor', 'camera', 'light'].includes(entry.type))
    if (selected.length < 2) return
    const originals = selected.map(entry => ({
      ...entry,
      original: (layout[entry.type + 's'] || []).find(item => item.id === entry.id),
    })).filter(entry => entry.original && !entry.original.locked)
    if (originals.length < 2) return
    const rotated = rotateObjectGroup(originals.map(entry => entry.original), degrees)
    const rotatedById = new Map(rotated.map(item => [item.id, item]))
    updateLayout(previous => {
      const next = { ...previous }
      for (const type of ['props', 'actors', 'cameras', 'lights']) {
        next[type] = previous[type].map(item => rotatedById.get(item.id) || item)
      }
      return next
    })
  }
  const deleteSelectedItems = () => {
    const selection = [...selectionRef.current]
    if (selection.length < 2) return
    const selectedRoomIds = new Set(selection.filter(item => item.type === 'room').map(item => item.id))
    const sharedRoomCount = reusableRoomMode
      ? [...selectedRoomIds].filter(id => scenes.some(item => item.id !== scene.id && item.roomIds?.includes(id))).length
      : 0
    const roomRemovalNote = sharedRoomCount
      ? ` ${sharedRoomCount} Room tersimpan juga akan dihapus dari scene lain yang menggunakannya.`
      : ''
    if (!window.confirm(`Hapus ${selection.length} objek yang dipilih dari denah? Tindakan ini tidak dapat dibatalkan.${roomRemovalNote}`)) return
    const selectedCameraIds = new Set(selection.filter(item => item.type === 'camera').map(item => item.id))
    const removedCameras = layout.cameras.filter(camera => selectedCameraIds.has(camera.id))
    const removedShots = removedCameras
      .map(camera => ({
        camera,
        shotIndex: scene.shots.findIndex(shot => shot.id === camera.shotId),
        shot: scene.shots.find(shot => shot.id === camera.shotId),
      }))
      .filter(entry => entry.shot)
    removedShots.forEach(({ camera, shotIndex, shot }) => {
      const previousRecord = autoCreatedShotsByCameraRef.current.get(camera.id)
      autoCreatedShotsByCameraRef.current.set(camera.id, {
        sceneId: scene.id,
        shot: { ...shot },
        shotIndex,
        autoCreated: Boolean(previousRecord?.autoCreated),
        deletedShot: true,
      })
    })
    const removedShotIds = new Set(removedShots.map(({ shot }) => shot.id))
    if (removedShotIds.size) {
      onChange(previousScenes => previousScenes.map(item => item.id !== scene.id ? item : ({
        ...item,
        shots: renumberShots(item.shots.filter(shot => !removedShotIds.has(shot.id))),
      })))
    }
    updateLayout(previous => {
      const next = { ...previous }
      for (const type of ['rooms', 'walls', 'props', 'actors', 'cameras', 'lights']) {
        const selectedIds = new Set(selection.filter(item => item.type + 's' === type).map(item => item.id))
        if (selectedIds.size) next[type] = previous[type].filter(item => !selectedIds.has(item.id))
      }
      return next
    })
    deleteReusableRooms(selectedRoomIds)
    applyEntitySelection([])
    onSelectedShotIdChange?.('')
    setTool('select')
  }

  const toggleEntitySelection = (type, id) => {
    const current = selectionRef.current
    const exists = current.some(item => item.type === type && item.id === id)
    if (exists) return
    applyEntitySelection([...current, { type, id }], { type, id })
  }

  const getPoint = event => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    // Workspace coordinates are intentionally unbounded: users can draw and pan
    // beyond the original 10 × 6 area without hitting an invisible canvas edge.
    return {
      x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
      y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height,
    }
  }

  // All zoom inputs share this anchor-preserving implementation.
  const zoomCanvas = (factor, clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const pointerX = rect && Number.isFinite(clientX) ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5
    const pointerY = rect && Number.isFinite(clientY) ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5
    setViewBox(current => {
      const width = current.width * factor
      const height = width / (MAP_WIDTH / MAP_HEIGHT)
      const anchorX = current.x + pointerX * current.width
      const anchorY = current.y + pointerY * current.height
      return {
        x: anchorX - pointerX * width,
        y: anchorY - pointerY * height,
        width,
        height,
      }
    })
  }

  const handleCanvasWheel = event => {
    const canvas = svgRef.current
    const editor = canvas?.closest('.floorplan-editor')
    const inspector = editor?.querySelector('.floorplan-inspector')
    const inspectorRect = inspector?.getBoundingClientRect()
    const pointerIsOverInspector = inspectorRect
      && event.clientX >= inspectorRect.left
      && event.clientX <= inspectorRect.right
      && event.clientY >= inspectorRect.top
      && event.clientY <= inspectorRect.bottom

    // If the pointer is visually over the properties panel, route the wheel
    // there instead of zooming the SVG, even if hit-testing overlaps the canvas.
    if (pointerIsOverInspector && inspector) {
      event.preventDefault()
      event.stopPropagation()
      inspector.scrollTop += event.deltaY
      return
    }

    event.preventDefault()
    event.stopPropagation()
    zoomCanvas(event.deltaY < 0 ? 0.87 : 1.13, event.clientX, event.clientY)
  }

  useEffect(() => {
    const canvas = svgRef.current
    if (!canvas) return undefined
    const handleWheel = event => handleCanvasWheel(event)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [viewBox])

  const handleCanvasTouchStart = event => {
    if (event.touches.length !== 2) return
    event.preventDefault()
    const [first, second] = Array.from(event.touches)
    const centerX = (first.clientX + second.clientX) / 2
    const centerY = (first.clientY + second.clientY) / 2
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    pinchRef.current = { distance, centerX, centerY }
    dragRef.current = null
    setSelectionBox(null)
    setDrawStart(null)
    setPreviewPoint(null)
  }

  const handleCanvasTouchMove = event => {
    if (event.touches.length !== 2 || !pinchRef.current) return
    event.preventDefault()
    const [first, second] = Array.from(event.touches)
    const centerX = (first.clientX + second.clientX) / 2
    const centerY = (first.clientY + second.clientY) / 2
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    if (distance > 0 && pinchRef.current.distance > 0) {
      const pinchZoomFactor = Math.max(0.2, 1 + ((pinchRef.current.distance / distance) - 1) * TOUCH_ZOOM_SENSITIVITY)
      zoomCanvas(pinchZoomFactor, centerX, centerY)
    }
    pinchRef.current = { distance, centerX, centerY }
  }

  const handleCanvasTouchEnd = event => {
    if (event.touches.length < 2) pinchRef.current = null
  }

  const resetZoom = () => setViewBox(current => ({
    x: current.x + current.width / 2 - MAP_WIDTH / 2,
    y: current.y + current.height / 2 - MAP_HEIGHT / 2,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  }))

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
      let createdShotAutomatically = false
      if (!targetShot) {
        targetShot = defaultShot(scene.shots.length + 1)
        createdShotAutomatically = true
        onChange(previous => previous.map(currentScene => currentScene.id !== scene.id ? currentScene : ({
          ...currentScene,
          shots: renumberShots([...currentScene.shots, targetShot]),
        })))
      }
      const cameraId = makeId()
      object = { id: cameraId, ...position, angle: 0, shotId: targetShot.id, path: [] }
      if (createdShotAutomatically) {
        autoCreatedShotsByCameraRef.current.set(cameraId, {
          sceneId: scene.id,
          shot: { ...targetShot },
          autoCreated: true,
        })
      }
      updateLayout(previous => ({ ...previous, cameras: [...previous.cameras, object] }))
      onSelectedShotIdChange?.(targetShot.id)
    }

    applyEntitySelection([{ type, id: object.id }], { type, id: object.id })
    if (type !== 'camera') onSelectedShotIdChange?.('')
    setTool('select')
  }

  const beginRoomEdgeDrag = (room, edgeIndex, event) => {
    if (tool === 'pan' || room.locked || event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
    setSelectedRoomEdge({ roomId: room.id, edgeIndex })
    onSelectedShotIdChange?.('')
    beginDragHistory()
    dragRef.current = {
      mode: 'room-edge',
      id: room.id,
      edgeIndex,
      start: getPoint(event),
      originalPoints: getRoomPoints(room).map(point => ({ ...point })),
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type: 'room', id: room.id })
    setTool('select')
  }

  const addRoomVertexOnEdge = (room, edgeIndex, event) => {
    if (tool === 'pan' || room.locked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const points = getRoomPoints(room).map(point => ({ ...point }))
    const start = points[edgeIndex]
    const end = points[(edgeIndex + 1) % points.length]
    if (!start || !end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < 4) return
    const pointer = getPoint(event)
    const t = Math.max(0.02, Math.min(0.98, ((pointer.x - start.x) * dx + (pointer.y - start.y) * dy) / lengthSquared))
    const point = { x: Math.round(start.x + dx * t), y: Math.round(start.y + dy * t) }
    // Avoid creating a duplicate vertex close to either endpoint.
    if (Math.hypot(point.x - start.x, point.y - start.y) < 3 || Math.hypot(point.x - end.x, point.y - end.y) < 3) return
    applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
    updateLayout(previous => ({
      ...previous,
      rooms: previous.rooms.map(item => {
        if (item.id !== room.id) return item
        const nextPoints = getRoomPoints(item).map(vertex => ({ ...vertex }))
        nextPoints.splice(edgeIndex + 1, 0, point)
        return { ...item, points: nextPoints }
      }),
    }))
    setSelected({ type: 'room', id: room.id })
    setTool('select')
  }

  const beginRoomFromVertex = () => {
    if (!roomVertexPrompt) return
    const point = { ...roomVertexPrompt.point }
    setRoomDrawPoints([point])
    setPreviewPoint(point)
    setRoomDrawMessage('Titik awal Room baru dipilih. Klik titik berikutnya untuk menggambar.')
    setRoomVertexPrompt(null)
    setTool('room')
  }

  const confirmRoomMerge = () => {
    if (!roomMergePrompt) return
    const moving = layout.rooms.find(room => room.id === roomMergePrompt.movingRoomId)
    const target = layout.rooms.find(room => room.id === roomMergePrompt.targetRoomId)
    if (!moving || !target) {
      setRoomMergePrompt(null)
      return
    }

    // A confirmed merge is one Room entity. Keep the target Room's ID, name,
    // and ceiling height, union the outer polygons, and preserve the former
    // shared wall as a visible internal wall. The resulting single polygon
    // remains draggable through the existing Room drag path.
    const movingEdge = roomMergePrompt.movingEdge
    const targetEdge = roomMergePrompt.targetEdge
    const snappedPoints = snapRoomToEdge(moving, movingEdge, targetEdge)
    if (!snappedPoints) {
      setRoomMergePrompt({ ...roomMergePrompt, error: 'Dinding tidak dapat disejajarkan. Coba geser Room sedikit lalu sambungkan kembali.' })
      return
    }

    const snappedMoving = { ...moving, points: snappedPoints }
    const merged = mergeAdjacentRoomPolygons(snappedMoving, target, {
      ...roomMergePrompt,
      movingEdge: {
        ...movingEdge,
        a: snappedPoints[movingEdge.index],
        b: snappedPoints[(movingEdge.index + 1) % snappedPoints.length],
      },
      targetEdge,
    }, reason => setRoomMergePrompt({ ...roomMergePrompt, error: reason }))
    if (!merged) return

    updateLayout(previous => ({
      ...previous,
      rooms: previous.rooms
        .filter(room => room.id !== moving.id && room.id !== target.id)
        .concat({
          ...target,
          points: merged.points,
          openings: merged.openings,
          internalWalls: merged.internalWalls,
          connectedRoomIds: [],
          mergeParts: {
            target: { ...target },
            moving: { ...snappedMoving },
          },
        }),
    }))
    applyEntitySelection([{ type: 'room', id: target.id }], { type: 'room', id: target.id })
    setRoomMergePrompt(null)
  }

  const unmergeRoom = room => {
    const parts = room?.mergeParts
    if (!parts?.target || !parts?.moving) return
    if (room.locked) return
    updateLayout(previous => ({
      ...previous,
      rooms: previous.rooms
        .filter(item => item.id !== room.id)
        .concat(
          { ...parts.target },
          { ...parts.moving },
        ),
    }))
    deleteReusableRooms(new Set([room.id]))
    applyEntitySelection([{ type: 'room', id: parts.target.id }], { type: 'room', id: parts.target.id })
    setSelectedRoomEdge(null)
    setSelectedRoomVertex(null)
  }

  const addRoomVertexAtEdgeMidpoint = room => {
    if (!room || room.locked || selectedRoomEdge?.roomId !== room.id) return
    const edgeIndex = selectedRoomEdge.edgeIndex
    const points = getRoomPoints(room).map(point => ({ ...point }))
    const start = points[edgeIndex]
    const end = points[(edgeIndex + 1) % points.length]
    if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 6) return
    const point = { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) }
    beginDragHistory()
    updateLayout(previous => ({
      ...previous,
      rooms: previous.rooms.map(item => {
        if (item.id !== room.id) return item
        const nextPoints = getRoomPoints(item).map(vertex => ({ ...vertex }))
        nextPoints.splice(edgeIndex + 1, 0, point)
        return { ...item, points: nextPoints }
      }),
    }))
    finishDragHistory()
    setSelectedRoomVertex({ roomId: room.id, vertexIndex: edgeIndex + 1 })
  }

  const beginRoomVertexDrag = (room, vertexIndex, event) => {
    if (tool === 'pan' || room.locked || event.detail > 1) return
    event.stopPropagation()
    event.preventDefault()
    applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
    setSelectedRoomVertex({ roomId: room.id, vertexIndex })
    beginDragHistory()
    dragRef.current = { mode: 'room-vertex', id: room.id, vertexIndex, start: getPoint(event), originalPoints: getRoomPoints(room).map(point => ({ ...point })) }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type: 'room', id: room.id })
    setTool('select')
  }

  const beginResize = (type, item, sx, sy, event) => {
    if (tool === 'pan') return
    event.stopPropagation()
    event.preventDefault()
    applyEntitySelection([{ type, id: item.id }], { type, id: item.id })
    setSelectedWaypoint(null)
    setSelected({ type, id: item.id })
    if (item.locked) return
    const point = getPoint(event)
    if (type !== 'camera') onSelectedShotIdChange?.('')
    beginDragHistory()
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
    if (tool === 'pan' || wall.locked) return
    event.stopPropagation()
    event.preventDefault()
    applyEntitySelection([{ type: 'wall', id: wall.id }], { type: 'wall', id: wall.id })
    onSelectedShotIdChange?.('')
    beginDragHistory()
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
    event.stopPropagation()
    if (tool === 'pan') return
    if (type === 'room' && !pointInPolygon(getPoint(event), getRoomPoints(item))) return

    if (event.shiftKey) {
      const wasSelected = selectionRef.current.some(entry => entry.type === type && entry.id === item.id)
      toggleEntitySelection(type, item.id)
      if (type === 'camera') onSelectedShotIdChange?.(wasSelected ? '' : (item.shotId || ''))
      return
    }

    const currentSelection = selectionRef.current
    const alreadySelected = currentSelection.some(entry => entry.type === type && entry.id === item.id)
    if (type !== 'room' && alreadySelected && currentSelection.length > 1) {
      setSelected({ type, id: item.id })
      setSelectedWaypoint(null)
    } else {
      applyEntitySelection([{ type, id: item.id }], { type, id: item.id })
    }

    if (type === 'camera') onSelectedShotIdChange?.(item.shotId || '')
    else if (!alreadySelected || currentSelection.length <= 1) onSelectedShotIdChange?.('')
    if (item.locked || (tool === 'room' && type !== 'room') || (tool === 'wall' && type !== 'wall')) return
    if (tool === 'path' || (tool === 'room' && type === 'room')) setTool('select')
    const point = getPoint(event)

    if (type !== 'room' && alreadySelected && currentSelection.length > 1) {
      const items = currentSelection.map(entry => ({
        ...entry,
        original: (layout[entry.type + 's'] || []).find(candidate => candidate.id === entry.id),
      })).filter(entry => entry.original && !entry.original.locked)
      if (!items.length) return
      beginDragHistory()
      dragRef.current = { mode: 'multi-move', start: point, items }
    } else {
      beginDragHistory()
      // A connected Room behaves like an opening hosted on a wall: it can
      // slide along the shared wall, but cannot drift away from that wall.
      let attachmentVector = null
      if (type === 'room' && Array.isArray(item.connectedRoomIds) && item.connectedRoomIds.length) {
        const connectedIds = new Set(item.connectedRoomIds)
        const candidate = findRoomMergeCandidate(item, layout.rooms, 18)
        if (candidate && connectedIds.has(candidate.targetRoomId)) {
          const edge = candidate.movingEdge
          const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) || 1
          attachmentVector = { x: (edge.b.x - edge.a.x) / length, y: (edge.b.y - edge.a.y) / length }
        }
      }
      dragRef.current = { mode: 'move', type, id: item.id, start: point, original: item, attachmentVector }
    }
    svgRef.current?.setPointerCapture?.(event.pointerId)
  }

  const beginWaypointDrag = (type, item, pathIndex, event) => {
    if (tool === 'pan' || item.locked) return
    event.stopPropagation()
    const point = getPoint(event)
    const waypoint = (item.path || [])[pathIndex]
    if (!waypoint) return
    applyEntitySelection([{ type, id: item.id }], { type, id: item.id })
    beginDragHistory()
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
    if (tool === 'pan' || item.locked) return
    event.stopPropagation()
    const point = getPoint(event)
    applyEntitySelection([{ type, id: item.id }], { type, id: item.id })
    beginDragHistory()
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
    if (!selectedEntity || selectedEntity.locked || !selectedType || (selectedType === 'camera' && !selectedCameraCanHavePath) || selectedType === 'light' || selectedType === 'room' || selectedType === 'wall') return
    setSelectedWaypoint(null)
    updateLayout(previous => ({
      ...previous,
      [selectedType + 's']: previous[selectedType + 's'].map(item => item.id !== selectedEntity.id
        ? item
        : { ...item, path: [...(item.path || []), { x: Math.round(point.x), y: Math.round(point.y) }] }),
    }))
  }

  const addOpening = type => {
    if (!selectedEntity || selectedEntity.locked || !['room', 'wall'].includes(selectedType)) return
    const opening = {
      id: makeId(),
      type,
      offset: 0.5,
      width: type === 'door' ? 48 : 58,
      height: type === 'door' ? 210 : 120,
      ...(type === 'door' ? { swingDirection: 'in', doorType: 'single' } : {}),
      ...(type === 'doorway' ? { label: 'Pintu Tanpa Daun', swingDirection: 'in' } : {}),
      ...(selectedType === 'room' ? (
        selectedRoomEdge?.roomId === selectedEntity.id && Number.isInteger(selectedRoomEdge.internalWallIndex)
          ? { wallType: 'internal', internalWallIndex: selectedRoomEdge.internalWallIndex }
          : { wallType: 'perimeter', edgeIndex: Math.max(0, getRoomPoints(selectedEntity).length - 1) }
      ) : {}),
    }
    updateSelected({ openings: [...(selectedEntity.openings || []), opening] })
    setTool('select')
  }

  const removeOpening = openingId => {
    if (!selectedEntity || selectedEntity.locked || !['room', 'wall'].includes(selectedType)) return
    updateSelected({ openings: (selectedEntity.openings || []).filter(opening => opening.id !== openingId) })
  }

  const updateOpening = (openingId, patch) => {
    if (!selectedEntity || selectedEntity.locked || !['room', 'wall'].includes(selectedType)) return
    const openings = (selectedEntity.openings || []).map(opening => {
      if (opening.id !== openingId) return opening
      const next = { ...opening, ...patch }
      const length = selectedType === 'room'
        ? (next.wallType === 'internal' && Number.isInteger(next.internalWallIndex)
          ? getWallMetrics(getRoomInternalWalls(selectedEntity)[next.internalWallIndex] || {}).length
          : getRoomEdges(selectedEntity)[Math.max(0, Math.min(getRoomEdges(selectedEntity).length - 1, Number(next.edgeIndex) || 0))]?.length) || 1
        : getWallMetrics(selectedEntity).length
      const openingWidth = Math.min(Math.max(1, Number(next.width) || 1), Math.max(1, length))
      const minimumOffset = Math.min(0.49, openingWidth / (2 * Math.max(1, length)))
      return { ...next, width: openingWidth, offset: clamp(next.offset, minimumOffset, 1 - minimumOffset) }
    })
    updateSelected({ openings })
  }

  const beginOpeningDrag = (hostType, host, opening, event) => {
    if (tool === 'pan' || host.locked) return
    event.stopPropagation()
    event.preventDefault()
    applyEntitySelection([{ type: hostType, id: host.id }], { type: hostType, id: host.id })
    beginDragHistory()
    dragRef.current = { mode: 'opening', type: hostType, id: host.id, openingId: opening.id }
    svgRef.current?.setPointerCapture?.(event.pointerId)
    setSelected({ type: hostType, id: host.id })
    setSelectedWaypoint(null)
    setTool('select')
  }

  const finishRoomDrawing = points => {
    if (points.length < 3) {
      setRoomDrawMessage('Room membutuhkan minimal 3 titik.')
      return false
    }
    const cleanPoints = points.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
    const area = Math.abs(cleanPoints.reduce((sum, point, index) => {
      const next = cleanPoints[(index + 1) % cleanPoints.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0)) / 2
    if (area < 16) {
      setRoomDrawMessage('Bentuk terlalu kecil atau tidak valid.')
      return false
    }
    const room = {
      id: makeId(),
      points: cleanPoints,
      label: 'Room ' + padNum(layout.rooms.length + 1),
      openings: [],
    }
    updateLayout(previous => ({ ...previous, rooms: [...previous.rooms, room] }))
    applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
    onSelectedShotIdChange?.('')
    setRoomDrawPoints([])
    setPreviewPoint(null)
    setRoomSnapGuides([])
    setRoomDrawMessage('')
    setRoomLengthInputOpen(false)
    setTool('select')
    return true
  }

  const addRoomDrawingPoint = point => {
    setRoomDrawMessage('')
    if (!roomDrawPoints.length) {
      setRoomDrawPoints([point])
      setPreviewPoint(point)
      setRoomSnapGuides([])
      return
    }
    const first = roomDrawPoints[0]
    const rect = svgRef.current?.getBoundingClientRect()
    const closeTolerance = 15 * (rect?.width ? viewBox.width / rect.width : 1)
    if (Math.hypot(point.x - first.x, point.y - first.y) <= closeTolerance) {
      finishRoomDrawing(roomDrawPoints)
      return
    }
    const previous = roomDrawPoints[roomDrawPoints.length - 1]
    const snapTolerance = 12 * viewBox.width / Math.max(1, svgRef.current?.getBoundingClientRect()?.width || canvasSize.width)
    const anchors = [
      ...layout.rooms.flatMap(room => getRoomPoints(room)),
      ...(layout.walls || []).flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
    ].filter(anchor => !(Math.abs(anchor.x - previous.x) < 0.01 && Math.abs(anchor.y - previous.y) < 0.01))
    const snappedPoint = point.altKey ? point : snapRoomPoint(point, previous, [...roomDrawPoints.slice(0, -1), ...anchors], snapTolerance).point
    if (Math.hypot(snappedPoint.x - previous.x, snappedPoint.y - previous.y) < 4) {
      setRoomDrawMessage('Garis terlalu pendek.')
      return
    }
    setRoomDrawPoints(points => [...points, snappedPoint])
    setPreviewPoint(snappedPoint)
  }

  const confirmManualRoomLength = () => {
    const meters = Number(roomLengthInput)
    if (!Number.isFinite(meters) || meters <= 0 || !roomDrawPoints.length || !previewPoint) {
      setRoomLengthInputOpen(false)
      return
    }
    const origin = roomDrawPoints[roomDrawPoints.length - 1]
    const dx = previewPoint.x - origin.x
    const dy = previewPoint.y - origin.y
    const angle = Number.isFinite(roomManualAngle) ? roomManualAngle : Math.atan2(dy, dx)
    const distance = meters * 100
    const nextPoint = { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance }
    setRoomDrawPoints(points => [...points, nextPoint])
    setPreviewPoint(nextPoint)
    setRoomLengthInputOpen(false)
    setRoomLengthInput('')
    setRoomManualAngle(null)
  }

  const getRoomAndWallSnapAnchors = () => [
    ...layout.rooms.flatMap(room => getRoomPoints(room)),
    ...(layout.walls || []).flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
  ]

  const snapPointToRoomAndWallGeometry = (point, origin = null) => {
    const anchors = getRoomAndWallSnapAnchors()
    const snapTolerance = 12 * viewBox.width / Math.max(1, svgRef.current?.getBoundingClientRect()?.width || canvasSize.width)
    const segments = [
      ...layout.rooms.flatMap(room => getRoomEdges(room).map(edge => ({ ...edge, sourceType: 'room', sourceId: room.id }))),
      ...(layout.walls || []).map(wall => ({ ...wall, sourceType: 'wall', sourceId: wall.id })),
    ]
    const nearestSegment = segments
      .map(segment => ({ ...projectPointToSegment(point, segment), segment }))
      .filter(candidate => candidate.distance <= snapTolerance)
      .sort((a, b) => a.distance - b.distance)[0]
    // Snap to the actual line segment first. This allows a new wall to meet an
    // existing Room boundary or Wall at any point, not just at a pre-existing
    // vertex. Endpoints are still exact shared coordinates.
    if (nearestSegment) {
      const projected = nearestSegment.point
      const guide = Math.abs(nearestSegment.segment.x2 - nearestSegment.segment.x1) >= Math.abs(nearestSegment.segment.y2 - nearestSegment.segment.y1)
        ? [{ axis: 'horizontal', y: projected.y, x: projected.x }]
        : [{ axis: 'vertical', x: projected.x, y: projected.y }]
      return { point: { x: Math.round(projected.x), y: Math.round(projected.y) }, guides: guide, connection: { type: nearestSegment.segment.sourceType, id: nearestSegment.segment.sourceId, t: nearestSegment.t } }
    }
    if (!anchors.length) return { point, guides: [] }
    // Preserve axis alignment snapping for endpoints that are not close to a
    // segment. Existing corners and wall endpoints remain first-class anchors.
    return origin
      ? snapRoomPoint(point, origin, anchors, snapTolerance)
      : snapRoomPoint(point, anchors[0], anchors.slice(1), snapTolerance)
  }

  const handleCanvasPointerDownCapture = event => {
    if (tool === 'wall' && event.button === 0 && !spaceHeld && !event.target?.closest?.('foreignObject')) {
      // Capture before Room/object handlers so a wall can start directly on
      // existing Room geometry instead of selecting the Room and aborting.
      event.preventDefault()
      event.stopPropagation()
      const point = getPoint(event)
      const snapped = snapPointToRoomAndWallGeometry(point)
      setDrawStart(snapped.point)
      setPreviewPoint(snapped.point)
      setRoomSnapGuides(snapped.guides)
      return
    }
    if (tool === 'room' && event.button === 0 && !spaceHeld && !event.target?.closest?.('foreignObject')) {
      event.preventDefault()
      event.stopPropagation()
      addRoomDrawingPoint({ ...getPoint(event), altKey: event.altKey })
      return
    }
    // Path mode must intercept object pointer handlers: rooms and props can
    // visually cover the selected actor, but must never steal a waypoint click.
    if (tool === 'path' && event.button === 0) {
      // Keep the click event alive; only prevent object selection/drag handlers.
      event.stopPropagation()
      return
    }

    // On touch devices, dragging empty canvas space in Select mode pans the
    // floorplan instead of creating a selection box. Touching an actual object
    // still reaches that object's handler, so object dragging remains intact.
    const touchPanOnEmptyCanvas = event.pointerType === 'touch'
      && tool === 'select'
      && !event.target?.closest?.('[data-floorplan-object="true"], [data-floorplan-waypoint="true"], foreignObject')

    // Navigation takes priority over any object handler, including on top of objects.
    if (!touchPanOnEmptyCanvas && event.button !== 1 && !(event.button === 0 && spaceHeld) && tool !== 'pan') return
    event.preventDefault()
    event.stopPropagation()
    svgRef.current?.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      mode: 'pan',
      startClientX: event.clientX,
      startClientY: event.clientY,
      viewBox: { ...viewBox },
    }
  }

  const handleCanvasPointerDown = event => {
    if (tool === 'room') return
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
    const clickedObject = event.target?.closest?.('[data-floorplan-object="true"], [data-floorplan-waypoint="true"]')
    if (tool === 'select' && !clickedObject) {
      const start = point
      dragRef.current = { mode: 'selection-box', start, current: start, additive: event.shiftKey }
      setSelectionBox({ x: start.x, y: start.y, width: 0, height: 0, additive: event.shiftKey })
      svgRef.current?.setPointerCapture?.(event.pointerId)
    }
  }

  const handleCanvasClickCapture = event => {
    if (tool !== 'path') return
    // Handle clicks before an SVG object's own onClick/onPointerDown can
    // select a room or prop that overlaps the actor whose path is being drawn.
    event.preventDefault()
    event.stopPropagation()
    // Double-click finishes the path and returns to Select/Move.
    if (event.detail > 1) {
      setTool('select')
      return
    }
    appendWaypoint(getPoint(event))
  }

  const handleCanvasClick = event => {
    // Path clicks are handled in capture phase so underlying objects cannot
    // intercept them.
    if (tool === 'path') {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const handleCanvasPointerMove = event => {
    const drag = dragRef.current
    if (drag?.mode === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || !rect.width || !rect.height) return
      const dx = ((event.clientX - drag.startClientX) / rect.width) * drag.viewBox.width * 1.3
      const dy = ((event.clientY - drag.startClientY) / rect.height) * drag.viewBox.height * 1.3
      setViewBox({
        ...drag.viewBox,
        x: drag.viewBox.x - dx,
        y: drag.viewBox.y - dy,
      })
      return
    }
    const point = getPoint(event)
    if (drag?.mode === 'selection-box') {
      drag.current = point
      setSelectionBox({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
        additive: drag.additive,
      })
      return
    }
    if (tool === 'room' && roomDrawPoints.length) {
      const origin = roomDrawPoints[roomDrawPoints.length - 1]
      const snapTolerance = 9 * viewBox.width / Math.max(1, svgRef.current?.getBoundingClientRect()?.width || canvasSize.width)
      const anchors = [
        ...layout.rooms.flatMap(room => getRoomPoints(room)),
        ...(layout.walls || []).flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
      ].filter(anchor => !(Math.abs(anchor.x - origin.x) < 0.01 && Math.abs(anchor.y - origin.y) < 0.01))
      if (roomLengthInputOpen || event.altKey) {
        setPreviewPoint(point)
        setRoomSnapGuides([])
      } else {
        const result = snapRoomPoint(point, origin, [...roomDrawPoints.slice(0, -1), ...anchors], snapTolerance)
        setPreviewPoint(result.point)
        setRoomSnapGuides(result.guides)
      }
      return
    }
    if (drawStart) {
      if (tool === 'wall') {
        if (event.altKey) {
          setPreviewPoint(point)
          setRoomSnapGuides([])
        } else {
          const snapped = snapPointToRoomAndWallGeometry(point, drawStart)
          setPreviewPoint(snapped.point)
          setRoomSnapGuides(snapped.guides)
        }
      } else {
        setPreviewPoint(point)
      }
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
        const isInternalOpening = opening.wallType === 'internal' && Number.isInteger(opening.internalWallIndex)
        const internalWall = isInternalOpening
          ? getRoomInternalWalls(host)[opening.internalWallIndex]
          : null
        if (isInternalOpening && !internalWall) {
          // Never silently reattach an internal-wall opening to the room perimeter.
          // A stale/missing wall should not make dragging teleport the opening outside.
          return
        }
        if (internalWall) {
          const metrics = getWallMetrics(internalWall)
          length = metrics.length || 1
          offset = ((point.x - internalWall.x1) * metrics.ux + (point.y - internalWall.y1) * metrics.uy) / length
          patch.wallType = 'internal'
          patch.internalWallIndex = opening.internalWallIndex
          patch.edgeIndex = null
        } else {
          const edges = getRoomEdges(host)
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
          patch.wallType = 'perimeter'
          patch.internalWallIndex = null
          patch.edgeIndex = nearestEdge.edgeIndex
        }
      }
      const openingWidth = Math.min(Number(opening.width ?? 48), length)
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
      updateLayout(previous => {
        const connected = updateWallEndpointGeometry(
          previous.rooms || [],
          previous.walls || [],
          drag.id,
          drag.endpoint,
          drag.endpoint === 'start'
            ? { x: endpointPatch.x1, y: endpointPatch.y1 }
            : { x: endpointPatch.x2, y: endpointPatch.y2 },
        )
        return { ...previous, rooms: connected.rooms, walls: connected.walls }
      })
      return
    }

    if (drag.mode === 'multi-move') {
      const dx = point.x - drag.start.x
      const dy = point.y - drag.start.y
      updateLayout(previous => {
        const next = { ...previous }
        for (const collection of ['rooms', 'walls', 'props', 'actors', 'cameras', 'lights']) {
          const selectedById = new Map(drag.items.filter(entry => entry.type + 's' === collection && !entry.original?.locked).map(entry => [entry.id, entry.original]))
          if (!selectedById.size) continue
          next[collection] = previous[collection].map(item => {
            const original = selectedById.get(item.id)
            if (!original) return item
            if (collection === 'rooms') return { ...item, points: getRoomPoints(original).map(vertex => ({
              x: Math.round(vertex.x + dx),
              y: Math.round(vertex.y + dy),
            })) }
            if (collection === 'walls') return {
              ...item,
              x1: Math.round(original.x1 + dx),
              y1: Math.round(original.y1 + dy),
              x2: Math.round(original.x2 + dx),
              y2: Math.round(original.y2 + dy),
            }
            return {
              ...item,
              x: Math.round(original.x + dx),
              y: Math.round(original.y + dy),
            }
          })
        }
        return next
      })
      return
    }

    if (drag.mode === 'room-edge') {
      const edge = getRoomEdges({ points: drag.originalPoints })[drag.edgeIndex]
      if (!edge) return
      const dx = point.x - drag.start.x
      const dy = point.y - drag.start.y
      const length = edge.length || 1
      const nx = (edge.y2 - edge.y1) / length
      const ny = -(edge.x2 - edge.x1) / length
      const distance = dx * nx + dy * ny
      const points = drag.originalPoints.map((vertex, index) => {
        if (index === drag.edgeIndex || index === (drag.edgeIndex + 1) % drag.originalPoints.length) {
          return { x: Math.round(vertex.x + nx * distance), y: Math.round(vertex.y + ny * distance) }
        }
        return vertex
      })
      updateLayout(previous => {
        const connected = updateRoomPolygonGeometry(previous.rooms || [], previous.walls || [], drag.id, points)
        return { ...previous, rooms: connected.rooms, walls: connected.walls }
      })
      return
    }

    if (drag.mode === 'room-vertex') {
      const originalVertex = drag.originalPoints[drag.vertexIndex]
      const snapTolerance = 9 * viewBox.width / Math.max(1, svgRef.current?.getBoundingClientRect()?.width || canvasSize.width)
      const anchors = [
        ...layout.rooms.flatMap(room => getRoomPoints(room).filter(vertex => !(room.id === drag.id && vertex === room.points?.[drag.vertexIndex]))),
        ...(layout.walls || []).flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
      ].filter(anchor => Math.hypot(anchor.x - originalVertex.x, anchor.y - originalVertex.y) > 0.01)
      if (event.altKey) {
        setRoomSnapGuides([])
      } else {
        const result = snapRoomPoint(point, originalVertex, anchors, snapTolerance)
        point.x = result.point.x
        point.y = result.point.y
        setRoomSnapGuides(result.guides)
      }
      const nextPoints = drag.originalPoints.map((vertex, index) => index === drag.vertexIndex
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : vertex)
      updateLayout(previous => {
        const connected = updateRoomPolygonGeometry(previous.rooms || [], previous.walls || [], drag.id, nextPoints)
        return { ...previous, rooms: connected.rooms, walls: connected.walls }
      })
      return
    }

    if (drag.mode === 'resize') {
      const original = drag.original
      const dx = point.x - drag.start.x
      const dy = point.y - drag.start.y
      if (drag.type === 'room') {
        const nextWidth = Math.round(clamp(
          original.width + dx * drag.signX,          40,
          Number.MAX_SAFE_INTEGER,
        ))
        const nextHeight = Math.round(clamp(
          original.height + dy * drag.signY,
          40,
          Number.MAX_SAFE_INTEGER,
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
          x: Math.round(original.x + shiftX * Math.cos(angle) - shiftY * Math.sin(angle)),
          y: Math.round(original.y + shiftX * Math.sin(angle) + shiftY * Math.cos(angle)),
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
        x: Math.round(point.x),
        y: Math.round(point.y),
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

    let dx = point.x - drag.start.x
    let dy = point.y - drag.start.y
    if (drag.type === 'room' && drag.attachmentVector) {
      const alongWall = dx * drag.attachmentVector.x + dy * drag.attachmentVector.y
      dx = alongWall * drag.attachmentVector.x
      dy = alongWall * drag.attachmentVector.y
    } else if (drag.type === 'room' && !event.altKey) {
      // Snap the entire Room as a rigid body, like Room drawing and opening
      // placement: first align nearby parallel wall segments, then weld a
      // nearby corner to the exact X/Y coordinates of another Room corner.
      const rect = svgRef.current?.getBoundingClientRect()
      const snapTolerance = 12 * viewBox.width / Math.max(1, rect?.width || canvasSize.width)
      const movedPoints = getRoomPoints(drag.original).map(vertex => ({ x: vertex.x + dx, y: vertex.y + dy }))
      const otherRooms = layout.rooms.filter(room => room.id !== drag.id)
      const otherEdges = otherRooms.flatMap(room => getRoomEdges(room))
      const edgeLength = edge => Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) || 1
      let bestEdgeSnap = null
      for (const movingEdge of getRoomEdges({ points: movedPoints })) {
        const length = edgeLength(movingEdge)
        const ux = (movingEdge.x2 - movingEdge.x1) / length
        const uy = (movingEdge.y2 - movingEdge.y1) / length
        for (const targetEdge of otherEdges) {
          const targetLength = edgeLength(targetEdge)
          const tx = (targetEdge.x2 - targetEdge.x1) / targetLength
          const ty = (targetEdge.y2 - targetEdge.y1) / targetLength
          if (Math.abs(ux * ty - uy * tx) > 0.035) continue
          const nx = -uy
          const ny = ux
          const signedDistance = (targetEdge.x1 - movingEdge.x1) * nx + (targetEdge.y1 - movingEdge.y1) * ny
          if (Math.abs(signedDistance) > snapTolerance) continue
          const projectionStart = (targetEdge.x1 - movingEdge.x1) * ux + (targetEdge.y1 - movingEdge.y1) * uy
          const projectionEnd = (targetEdge.x2 - movingEdge.x1) * ux + (targetEdge.y2 - movingEdge.y1) * uy
          const overlap = Math.min(length, Math.max(projectionStart, projectionEnd)) - Math.max(0, Math.min(projectionStart, projectionEnd))
          if (overlap < -snapTolerance) continue
          if (!bestEdgeSnap || Math.abs(signedDistance) < Math.abs(bestEdgeSnap.distance)) bestEdgeSnap = { distance: signedDistance, nx, ny }
        }
      }
      if (bestEdgeSnap) {
        dx += bestEdgeSnap.nx * bestEdgeSnap.distance
        dy += bestEdgeSnap.ny * bestEdgeSnap.distance
      }

      const snappedPoints = getRoomPoints(drag.original).map(vertex => ({ x: vertex.x + dx, y: vertex.y + dy }))
      const anchors = [
        ...otherRooms.flatMap(room => getRoomPoints(room)),
        ...(layout.walls || []).flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
      ]
      let bestCorner = null
      let bestX = null
      let bestY = null
      for (const vertex of snappedPoints) {
        for (const anchor of anchors) {
          const sx = anchor.x - vertex.x
          const sy = anchor.y - vertex.y
          if (Math.abs(sx) <= snapTolerance && Math.abs(sy) <= snapTolerance) {
            const score = Math.hypot(sx, sy)
            if (!bestCorner || score < bestCorner.score) bestCorner = { dx: sx, dy: sy, score, anchor }
          }
          if (Math.abs(sx) <= snapTolerance && (!bestX || Math.abs(sx) < Math.abs(bestX.delta))) bestX = { delta: sx, anchor }
          if (Math.abs(sy) <= snapTolerance && (!bestY || Math.abs(sy) < Math.abs(bestY.delta))) bestY = { delta: sy, anchor }
        }
      }
      if (bestCorner) {
        dx += bestCorner.dx
        dy += bestCorner.dy
        setRoomSnapGuides([
          { axis: 'vertical', x: bestCorner.anchor.x, y: bestCorner.anchor.y },
          { axis: 'horizontal', x: bestCorner.anchor.x, y: bestCorner.anchor.y },
        ])
      } else {
        if (bestX) dx += bestX.delta
        if (bestY) dy += bestY.delta
        const guides = []
        if (bestX) guides.push({ axis: 'vertical', x: bestX.anchor.x, y: bestX.anchor.y })
        if (bestY) guides.push({ axis: 'horizontal', x: bestY.anchor.x, y: bestY.anchor.y })
        if (!guides.length && bestEdgeSnap) {
          const point = movedPoints[0] || { x: 0, y: 0 }
          guides.push({ axis: Math.abs(bestEdgeSnap.nx) > Math.abs(bestEdgeSnap.ny) ? 'vertical' : 'horizontal', x: point.x + dx, y: point.y + dy })
        }
        setRoomSnapGuides(guides)
      }
    } else if (drag.type === 'room' && event.altKey) {
      setRoomSnapGuides([])
    }
    updateLayout(previous => {
      if (drag.type === 'room') {
        const movedPoints = getRoomPoints(drag.original).map(vertex => ({
          x: Math.round(vertex.x + dx),
          y: Math.round(vertex.y + dy),
        }))
        const connected = updateRoomPolygonGeometry(previous.rooms || [], previous.walls || [], drag.id, movedPoints)
        return {
          ...previous,
          rooms: connected.rooms.map(item => item.id !== drag.id ? item : ({
            ...item,
            internalWalls: (drag.original.internalWalls || []).map(wall => ({
              x1: Math.round(wall.x1 + dx), y1: Math.round(wall.y1 + dy),
              x2: Math.round(wall.x2 + dx), y2: Math.round(wall.y2 + dy),
            })),
          })),
          walls: connected.walls,
        }
      }
      return {
      ...previous,
      [drag.type + 's']: previous[drag.type + 's'].map(item => {
        if (item.id !== drag.id) return item
        if (['actor', 'camera', 'light', 'door', 'window', 'prop'].includes(drag.type)) {
          return {
            ...item,
            x: Math.round(drag.original.x + dx),
            y: Math.round(drag.original.y + dy),
          }
        }
        if (drag.type === 'room') {
          if (item.locked) return item
          return {
            ...item,
            points: getRoomPoints(drag.original).map(vertex => ({
              x: Math.round(vertex.x + dx),
              y: Math.round(vertex.y + dy),
            })),
            internalWalls: (drag.original.internalWalls || []).map(wall => ({
              x1: Math.round(wall.x1 + dx), y1: Math.round(wall.y1 + dy),
              x2: Math.round(wall.x2 + dx), y2: Math.round(wall.y2 + dy),
            })),
          }
        }
        if (drag.type === 'wall') {
          return {
            ...item,
            x1: Math.round(drag.original.x1 + dx),
            y1: Math.round(drag.original.y1 + dy),
            x2: Math.round(drag.original.x2 + dx),
            y2: Math.round(drag.original.y2 + dy),
          }
        }
        return item
      }),
      }
    })
  }

  const handleCanvasPointerUp = event => {
    const completedDrag = dragRef.current
    // Release pointer capture before opening a dialog. Otherwise the pointer's
    // click sequence can remain targeted at the SVG instead of the dialog button.
    if (event?.pointerId != null && svgRef.current?.hasPointerCapture?.(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
    if (completedDrag?.mode === 'move' && completedDrag.type === 'room') {
      // Pointer-up can run with a stale React render closure after the final
      // pointer-move update. Read the latest layout snapshot so the merge
      // candidate is calculated from the Room's actual dropped position.
      const currentLayout = layoutRef.current || layout
      const movedRoom = currentLayout.rooms.find(room => room.id === completedDrag.id)
      const candidate = movedRoom && findRoomMergeCandidate(movedRoom, currentLayout.rooms, 18)
      const alreadyConnected = candidate && (movedRoom.connectedRoomIds || []).includes(candidate.targetRoomId)
      if (candidate && !alreadyConnected) setRoomMergePrompt(candidate)
    }
    if (completedDrag?.mode === 'room-vertex' || (completedDrag?.mode === 'move' && completedDrag.type === 'room')) setRoomSnapGuides([])
    if (completedDrag?.mode === 'selection-box') {
      const end = completedDrag.current || completedDrag.start
      const bounds = {
        left: Math.min(completedDrag.start.x, end.x),
        top: Math.min(completedDrag.start.y, end.y),
        right: Math.max(completedDrag.start.x, end.x),
        bottom: Math.max(completedDrag.start.y, end.y),
      }
      const draggedDistance = Math.hypot(end.x - completedDrag.start.x, end.y - completedDrag.start.y)
      setSelectionBox(null)
      dragRef.current = null
      if (draggedDistance < 4) {
        if (!completedDrag.additive) applyEntitySelection([])
        return
      }
      const hits = allObjects.filter(object => {
        const type = object.entityType
        const box = type === 'room'
          ? (() => { const bounds = getRoomBounds(object); return { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height } })()
          : type === 'wall'
            ? { left: Math.min(object.x1, object.x2), top: Math.min(object.y1, object.y2), right: Math.max(object.x1, object.x2), bottom: Math.max(object.y1, object.y2) }
            : {
              left: object.x - (type === 'prop' ? (Number(object.width) || 52) / 2 : 22),
              top: object.y - (type === 'prop' ? (Number(object.height) || 36) / 2 : 22),
              right: object.x + (type === 'prop' ? (Number(object.width) || 52) / 2 : 22),
              bottom: object.y + (type === 'prop' ? (Number(object.height) || 36) / 2 : 22),
            }
        return box.right >= bounds.left && box.left <= bounds.right
          && box.bottom >= bounds.top && box.top <= bounds.bottom
      }).map(object => ({ type: object.entityType, id: object.id }))
      const combined = completedDrag.additive ? [...selectionRef.current, ...hits] : hits
      applyEntitySelection(combined, hits[hits.length - 1] || null)
      return
    }
    if (drawStart && previewPoint) {
      const width = Math.abs(previewPoint.x - drawStart.x)
      const height = Math.abs(previewPoint.y - drawStart.y)
      if (tool === 'room' && width >= 12 && height >= 12) {
        const room = createRoomPolygon(drawStart, previewPoint, makeId(), 'Room ' + padNum(layout.rooms.length + 1))
        if (!room) return
        updateLayout(previous => ({ ...previous, rooms: [...previous.rooms, room] }))
        applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
        onSelectedShotIdChange?.('')
        setTool('select')
      } else if (tool === 'wall' && Math.hypot(width, height) >= 8) {
        const wall = {
          id: makeId(),
          x1: Math.round(drawStart.x), y1: Math.round(drawStart.y),
          x2: Math.round(previewPoint.x), y2: Math.round(previewPoint.y),
          thickness: 6,
          openings: [],
        }
        updateLayout(previous => {
          const connected = connectWallGeometry(previous.rooms || [], previous.walls || [], wall, makeId)
          return { ...previous, rooms: connected.rooms, walls: connected.walls }
        })
        applyEntitySelection([{ type: 'wall', id: wall.id }], { type: 'wall', id: wall.id })
        onSelectedShotIdChange?.('')
        setTool('select')
      }
    }
    setDrawStart(null)
    setPreviewPoint(null)
    if (tool === 'wall') setRoomSnapGuides([])
    if (completedDrag && ['move', 'multi-move', 'resize', 'room-vertex', 'room-edge', 'wall-endpoint', 'waypoint', 'rotate', 'opening'].includes(completedDrag.mode)) {
      finishDragHistory()
    }
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
    if (!selectedWaypoint || !selected || selectedEntity?.locked || selectedWaypoint.type !== selected.type || selectedWaypoint.id !== selected.id) return
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
      : null)  }

  useEffect(() => {
    if (!isActive) return undefined
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
  }, [isActive, selectedWaypoint, selected, layout])

  const changeCameraLink = (camera, nextShotId) => {
    const anotherCamera = layout.cameras.find(item => item.shotId === nextShotId && item.id !== camera.id)
    if (nextShotId && anotherCamera) {
      window.alert('Shot tersebut sudah memiliki marker kamera. Pilih shot yang lain.')
      return
    }
    updateSelected({ shotId: nextShotId })
    onSelectedShotIdChange?.(nextShotId || '')
  }

  const deleteSelected = () => {
    if (!selected) return

    if (selected.type === 'room' && reusableRoomMode) {
      const usedByOtherScenes = scenes.filter(item => item.id !== scene.id && item.roomIds?.includes(selected.id)).length
      if (usedByOtherScenes && !window.confirm(`Room ini juga digunakan di ${usedByOtherScenes} scene lain. Hapus Room tersimpan dan lepaskan dari semua scene? Tindakan ini tidak dapat dibatalkan.`)) return
    }

    // A camera marker represents the shot linked to it. Remove that linked
    // shot when deleting the camera, including shots created before this
    // component session (the in-memory auto-created-shot map is not persistent).
    const camera = selected.type === 'camera'
      ? layout.cameras.find(item => item.id === selected.id)
      : null
    const linkedShotId = camera?.shotId || ''
    if (linkedShotId) {
      const shotIndex = scene.shots.findIndex(shot => shot.id === linkedShotId)
      const linkedShot = scene.shots[shotIndex]
      if (linkedShot) {
        const previousRecord = autoCreatedShotsByCameraRef.current.get(selected.id)
        autoCreatedShotsByCameraRef.current.set(selected.id, {
          sceneId: scene.id,
          shot: { ...linkedShot },
          shotIndex,
          autoCreated: Boolean(previousRecord?.autoCreated),
          deletedShot: true,
        })
      }
      onChange(previousScenes => previousScenes.map(item => item.id !== scene.id ? item : ({
        ...item,
        shots: renumberShots(item.shots.filter(shot => shot.id !== linkedShotId)),
      })))
    }

    updateLayout(previous => ({
      ...previous,
      [selected.type + 's']: previous[selected.type + 's'].filter(item => item.id !== selected.id),
    }))
    if (selected.type === 'room') deleteReusableRooms(new Set([selected.id]))
    applyEntitySelection([])
    onSelectedShotIdChange?.('')
    setTool('select')
  }

  useEffect(() => {
    if (!isActive) {
      setSpaceHeld(false)
      return undefined
    }
    const isEditableTarget = target => target instanceof HTMLElement && (
      target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    )
    const handleSpaceDown = event => {
      if (event.code !== 'Space' || isEditableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const handleSpaceUp = event => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    const handleWindowBlur = () => setSpaceHeld(false)
    window.addEventListener('keydown', handleSpaceDown)
    window.addEventListener('keyup', handleSpaceUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleSpaceDown)
      window.removeEventListener('keyup', handleSpaceUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [isActive])

  const deleteSelectedRoomVertex = () => {
    if (!selectedRoomVertex) return false
    const { roomId, vertexIndex } = selectedRoomVertex
    const room = (layoutRef.current?.rooms || layout.rooms).find(item => item.id === roomId)
    if (!room || room.locked) {
      setSelectedRoomVertex(null)
      return true
    }
    const points = getRoomPoints(room)
    if (points.length <= 3) {
      window.alert('Room harus memiliki minimal 3 titik sudut.')
      return true
    }
    const nextPoints = points.filter((_, index) => index !== vertexIndex)
    if (nextPoints.length < 3) return true
    const area = Math.abs(nextPoints.reduce((sum, point, index) => {
      const next = nextPoints[(index + 1) % nextPoints.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0)) / 2
    if (area < 16) {
      window.alert('Titik ini tidak bisa dihapus karena bentuk Room akan menjadi tidak valid.')
      return true
    }
    beginDragHistory()
    updateLayout(previous => ({
      ...previous,
      rooms: previous.rooms.map(item => item.id === roomId ? { ...item, points: nextPoints } : item),
    }))
    finishDragHistory()
    setSelectedRoomVertex(null)
    applyEntitySelection([{ type: 'room', id: roomId }], { type: 'room', id: roomId })
    return true
  }

  useEffect(() => {
    if (!isActive) return undefined

  const handleFloorplanShortcut = event => {
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )) return
      if (event.altKey || event.defaultPrevented) return

      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault()
        selectAllObjects()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoLayout()
        else undoLayout()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        redoLayout()
        return
      }
      if (event.ctrlKey || event.metaKey) return
      if (['delete', 'backspace'].includes(key)) {
        if (selectedRoomVertex) {
          event.preventDefault()
          deleteSelectedRoomVertex()
        } else if (selectedWaypoint) {
          event.preventDefault()
          deleteSelectedWaypoint()
        } else if (selectionRef.current.length > 1) {
          event.preventDefault()
          deleteSelectedItems()
        } else if (selected) {
          event.preventDefault()
          deleteSelected()
        }
        return
      }
      if (key === 'escape') {
        if (tool === 'room' && roomDrawPoints.length) {
          event.preventDefault()
          setRoomDrawPoints([])
          setPreviewPoint(null)
          setRoomLengthInputOpen(false)
          setRoomDrawMessage('')
          return
        }
        event.preventDefault()
        applyEntitySelection([])
        setSelectedWaypoint(null)
        onSelectedShotIdChange?.('')
        setTool('select')
        return
      }
      if (tool === 'room' && roomDrawPoints.length && key === 'enter') {
        event.preventDefault()
        finishRoomDrawing(roomDrawPoints)
        return
      }
      if (tool === 'room' && roomDrawPoints.length && key === 'tab') {
        event.preventDefault()
        const origin = roomDrawPoints[roomDrawPoints.length - 1]
        setRoomManualAngle(Math.atan2(previewPoint.y - origin.y, previewPoint.x - origin.x))
        setRoomLengthInputOpen(true)
        setRoomLengthInput('')
        return
      }
      if (key === 'v') {
        event.preventDefault()
        setTool('select')
        setSelectedWaypoint(null)
        return
      }
      if (key === 'c') {
        event.preventDefault()
        addObject('camera')
        return
      }
      if (key === 'l') {
        event.preventDefault()
        addObject('light')
        return
      }
    }
    window.addEventListener('keydown', handleFloorplanShortcut)
    return () => window.removeEventListener('keydown', handleFloorplanShortcut)
  }, [isActive, addObject, allObjects, deleteSelected, deleteSelectedItems, deleteSelectedWaypoint, deleteSelectedRoomVertex, finishRoomDrawing, redoLayout, roomDrawPoints, selectAllObjects, selected, selectedItems, selectedRoomVertex, selectedWaypoint, tool, undoLayout])

  const clearLayout = () => {
    const roomIds = new Set(layout.rooms.map(room => room.id))
    const sharedRoomCount = reusableRoomMode
      ? [...roomIds].filter(id => scenes.some(item => item.id !== scene.id && item.roomIds?.includes(id))).length
      : 0
    const roomRemovalNote = sharedRoomCount
      ? ` ${sharedRoomCount} Room tersimpan juga akan dihapus dari scene lain yang menggunakannya.`
      : ''
    if (!window.confirm(`Kosongkan room, wall, properti, aktor, kamera, dan lampu pada scene ini?${roomRemovalNote}`)) return
    updateLayout(() => ({ ...EMPTY_LAYOUT }))
    deleteReusableRooms(roomIds)
    applyEntitySelection([])
    onSelectedShotIdChange?.('')
    setSelectedWaypoint(null)
    setTool('select')
  }

  const objectName = (type, item) => {
    if (type === 'camera') {
      const shot = scene.shots.find(entry => entry.id === item.shotId)
      return shot ? ('Shot ' + shot.num + (shot.subject ? ' — ' + shot.subject : '')) : 'Unlinked camera'
    }
    if (type === 'light') return (item.label || 'Light') + ' — ' + (item.lightType || 'Key')
    if (type === 'prop') return item.label || 'Prop'
    const fallback = ({ room: 'Room', wall: 'Wall', door: 'Pintu', window: 'Jendela', actor: 'Actor' })[type] || type
    return item.label || fallback
  }

  const objectTypeLabel = type => ({
    actor: 'Actor', camera: 'Camera', light: 'Lighting', room: 'Room',
    wall: 'Wall', prop: 'Prop',
  })[type] || type
  const objectCount = layout.rooms.length + layout.walls.length + layout.props.length + layout.actors.length + layout.cameras.length + layout.lights.length
  const targetScaleMeters = Math.max(0.01, viewBox.width * 84 / Math.max(1, canvasSize.width) / 100)
  const scalePower = 10 ** Math.floor(Math.log10(targetScaleMeters))
  const scaleUnit = targetScaleMeters / scalePower
  const scaleMeters = (scaleUnit <= 1 ? 1 : scaleUnit <= 2 ? 2 : scaleUnit <= 5 ? 5 : 10) * scalePower
  const scaleBarWidth = Math.max(36, Math.min(120, scaleMeters * 100 / viewBox.width * canvasSize.width))
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
        <div className="floorplan-scene-slugline" aria-label="Informasi scene, tersinkron dengan Shot List">
          <select
            className="floorplan-scene-slugline-type"
            aria-label="Interior atau eksterior"
            value={scene.intExt || 'INT'}
            onChange={event => onChange(previous => previous.map(item => item.id === scene.id ? { ...item, intExt: event.target.value } : item))}
          >
            <option>INT</option>
            <option>EXT</option>
            <option>INT/EXT</option>
          </select>
          <input
            className="floorplan-scene-slugline-location"
            aria-label="Lokasi scene"
            value={scene.location || ''}
            onChange={event => onChange(previous => previous.map(item => item.id === scene.id ? { ...item, location: event.target.value } : item))}
            placeholder="Lokasi"
            maxLength={300}
          />
          <span className="floorplan-scene-slugline-separator" aria-hidden="true">·</span>
          <select
            className="floorplan-scene-slugline-time"
            aria-label="Waktu scene"
            value={scene.dayNight || 'DAY'}
            onChange={event => onChange(previous => previous.map(item => item.id === scene.id ? { ...item, dayNight: event.target.value } : item))}
          >
            <option>DAY</option>
            <option>NIGHT</option>
            <option>DAWN</option>
            <option>DUSK</option>
          </select>
        </div>
      </header>

      <div className="floorplan-main-tools" role="toolbar" aria-label="Alat Floorplan">
        <div className="floorplan-tool-group floorplan-history-tools" aria-label="Riwayat aksi">
          <button type="button" className="floorplan-tool-button floorplan-history-button" onClick={undoLayout} disabled={!canUndo} title="Urungkan (Ctrl+Z)" aria-label="Urungkan aksi" aria-keyshortcuts="Control+Z Meta+Z">
            <Undo2 size={17} /><span>Urungkan</span>
          </button>
          <button type="button" className="floorplan-tool-button floorplan-history-button" onClick={redoLayout} disabled={!canRedo} title="Ulangi (Ctrl+Shift+Z)" aria-label="Ulangi aksi" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
            <Redo2 size={17} /><span>Ulangi</span>
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-tool-group">
          <button className={'floorplan-tool-button' + (tool === 'select' ? ' active' : '')} onClick={() => setTool('select')} title="Pilih dan pindahkan (V)" aria-label="Pilih dan pindahkan (V)" aria-pressed={tool === 'select'}>
            <MousePointer2 size={19} /><kbd className="floorplan-shortcut-key">V</kbd>
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
          <button type="button" className={'floorplan-tool-button' + (showRoomDimensions ? ' active' : '')} onClick={() => setShowRoomDimensions(value => !value)} title={showRoomDimensions ? 'Sembunyikan dimensi Room' : 'Tampilkan dimensi Room'} aria-pressed={showRoomDimensions}><Ruler size={18} /><span>Dimensi</span></button>
          <button type="button" className={'floorplan-tool-button' + (showObjectLabels ? ' active' : '')} onClick={() => setShowObjectLabels(value => !value)} title={showObjectLabels ? 'Sembunyikan nama objek' : 'Tampilkan nama objek'} aria-pressed={showObjectLabels}><Tag size={18} /><span>Nama objek</span></button>
          <button className={'floorplan-tool-button' + (tool === 'room' ? ' active' : '')} onClick={() => setTool('room')} title="Gambar Room titik demi titik" aria-label="Gambar Room baru" aria-pressed={tool === 'room'}>
            <Square size={18} /><span>Ruang</span>
          </button>
          {reusableRoomMode && projectRooms.some(room => !(scene?.roomIds || []).includes(room.id)) && (
            <label className="floorplan-reuse-room-control">
              <span>Gunakan Room</span>
              <select
                aria-label="Gunakan Room yang sudah dibuat"
                value=""
                onChange={event => {
                  const roomId = event.target.value
                  if (!roomId || !scene) return
                  onChange?.(previous => previous.map(item => item.id === scene.id
                    ? { ...item, roomIds: [...new Set([...(item.roomIds || []), roomId])] }
                    : item))
                  setSelected({ type: 'room', id: roomId })
                  setTool('select')
                  event.target.value = ''
                }}
              >
                <option value="">Pilih Room tersimpan…</option>
                {projectRooms.filter(room => !(scene?.roomIds || []).includes(room.id)).map(room => (
                  <option key={room.id} value={room.id}>{room.label || 'Room'}</option>
                ))}
              </select>
            </label>
          )}
          <button className={'floorplan-tool-button' + (tool === 'wall' ? ' active' : '')} onClick={() => setTool('wall')} title="Gambar dinding dengan menggeser kedua ujungnya" aria-label="Gambar dinding" aria-pressed={tool === 'wall'}>
            <Minus size={19} /><span>Dinding</span>
          </button>
        </div>
        <span className="floorplan-tool-divider" />
        <div className="floorplan-tool-group">          <button className="floorplan-tool-button" onClick={() => addObject('actor')} title="Tambah aktor" aria-label="Tambah aktor">
            <FloorplanObjectIcon type="actor" size={22} /><span>Aktor</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('camera')} title="Tambah kamera dan hubungkan ke shot (C)" aria-label="Tambah kamera (C)">
            <FloorplanObjectIcon type="camera" size={22} /><span>Kamera</span><kbd className="floorplan-shortcut-key">C</kbd>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('prop')} title="Tambah properti atau furnitur" aria-label="Tambah properti">
            <FloorplanObjectIcon type="prop" size={22} /><span>Properti</span>
          </button>
          <button className="floorplan-tool-button" onClick={() => addObject('light')} title="Tambah lampu (L)" aria-label="Tambah lampu (L)">
            <FloorplanObjectIcon type="light" size={22} /><span>Lampu</span><kbd className="floorplan-shortcut-key">L</kbd>
          </button>
        </div>
        <span className="floorplan-tool-spacer" />
        {allObjects.length > 1 && (
          <button type="button" className="floorplan-tool-button" onClick={selectAllObjects} title="Pilih semua objek di scene ini" aria-label="Pilih semua objek">
            <MousePointer2 size={17} /><span>Pilih semua</span>
          </button>
        )}
        {selectedItems.length > 1 && (
          <div className="floorplan-selection-actions" role="group" aria-label="Aksi beberapa objek terpilih">
            <span>{selectedItems.length} objek dipilih</span>
            {selectedItems.filter(entry => ['prop', 'actor', 'camera', 'light'].includes(entry.type)).length > 1 && <>
              <button type="button" className="floorplan-selection-rotate" onClick={() => rotateSelectedGroup(-15)} title="Putar grup 15° ke kiri"><RotateCcw size={14} /> −15°</button>
              <button type="button" className="floorplan-selection-rotate" onClick={() => rotateSelectedGroup(15)} title="Putar grup 15° ke kanan"><RotateCw size={14} /> +15°</button>
            </>}
            <button type="button" className="floorplan-selection-delete" onClick={deleteSelectedItems}><Trash2 size={14} /> Hapus pilihan</button>
            <button type="button" className="floorplan-selection-clear" onClick={() => applyEntitySelection([])} title="Batalkan pilihan" aria-label="Batalkan pilihan"><X size={14} /></button>
          </div>
        )}
        <button className="floorplan-icon-button floorplan-clear-button" onClick={clearLayout} title="Kosongkan layout scene ini" aria-label="Kosongkan layout scene ini">
          <Trash2 size={17} />
        </button>
      </div>

      <div className="floorplan-editor">
        <div className="floorplan-canvas-column">
          <div className="floorplan-canvas-frame">
            <div className="floorplan-scale-indicator" aria-label={'Skala ' + scaleMeters + ' meter'}>
              <span className="floorplan-scale-label">{scaleMeters} m</span>
              <span className="floorplan-scale-bar" style={{ width: scaleBarWidth }} />
              <span className="floorplan-scale-caption">Skala denah · 100 unit = 1 m</span>
            </div>
            {scene?.shots?.length > 0 && <>
              <div className="floorplan-shot-navigation floorplan-canvas-shot-navigation" role="group" aria-label="Navigasi shot Floorplan">
                <button type="button" className="floorplan-shot-step" onClick={() => moveFloorplanShot(-1)} disabled={activeFloorplanShotIndex === 0} aria-label="Shot sebelumnya di Floorplan" title="Shot sebelumnya"><ChevronLeft size={16} /></button>
                <label className="floorplan-shot-picker">
                  <span>Shot</span>
                  <select aria-label="Pilih shot untuk Floorplan" value={activeFloorplanShot?.id || ''} onChange={event => onSelectedShotIdChange?.(event.target.value)}>
                    {scene.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.num} — {shot.subject || 'Subjek belum diisi'}</option>)}
                  </select>
                </label>
                <span className="floorplan-shot-position">{activeFloorplanShotIndex + 1}/{scene.shots.length}</span>
                <button type="button" className="floorplan-shot-step" onClick={() => moveFloorplanShot(1)} disabled={activeFloorplanShotIndex >= scene.shots.length - 1} aria-label="Shot berikutnya di Floorplan" title="Shot berikutnya"><ChevronRight size={16} /></button>
                <button type="button" className={'floorplan-shot-focus' + (shotFocusMode ? ' active' : '')} onClick={() => { if (!shotFocusMode && activeFloorplanShot) onSelectedShotIdChange?.(activeFloorplanShot.id); setShotFocusMode(value => !value) }} aria-pressed={shotFocusMode} title="Fokus pada kamera shot terpilih">{shotFocusMode ? 'Fokus aktif' : 'Fokus shot'}</button>
              </div>
            </>}
            <svg
              ref={svgRef}
              className={'floorplan-canvas' + (spaceHeld || tool === 'pan' ? ' can-pan' : tool === 'select' ? ' can-select' : ' can-draw')}
              style={{ touchAction: 'none', cursor: spaceHeld || tool === 'pan' || dragRef.current?.mode === 'pan' ? 'grab' : undefined }}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              width={canvasSize.width}
              height={canvasSize.height}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Kanvas Floorplan tampak atas"
              onPointerDownCapture={handleCanvasPointerDownCapture}
              onPointerDown={handleCanvasPointerDown}
              onTouchStart={handleCanvasTouchStart}
              onTouchMove={handleCanvasTouchMove}
              onTouchEnd={handleCanvasTouchEnd}
              onTouchCancel={handleCanvasTouchEnd}
              onClickCapture={handleCanvasClickCapture}
              onClick={handleCanvasClick}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            >
              <defs>
                <marker id="floorplan-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill="var(--text-muted)" />
                </marker>
                <pattern id="floorplan-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--border)" strokeWidth="0.8" strokeOpacity="0.5" />
                </pattern>
              </defs>
              <rect x={viewBox.x - viewBox.width * 2} y={viewBox.y - viewBox.height * 2} width={viewBox.width * 5} height={viewBox.height * 5} fill="var(--bg)" />
              <rect x={viewBox.x - viewBox.width * 2} y={viewBox.y - viewBox.height * 2} width={viewBox.width * 5} height={viewBox.height * 5} fill="url(#floorplan-grid)" pointerEvents="none" />
              {layout.rooms.map(room => {
                const points = getRoomPoints(room)
                const pointString = points.map(point => point.x + ',' + point.y).join(' ')
                const openings = room.openings || []
                const active = selected?.type === 'room' && selected.id === room.id

                const bounds = getRoomBounds(room)
                const edges = getRoomEdges(room)
                const connectedRoomIds = new Set(Array.isArray(room.connectedRoomIds) ? room.connectedRoomIds : [])
                const connectedRooms = layout.rooms.filter(candidate => connectedRoomIds.has(candidate.id))
                const isSharedRoomEdge = edge => connectedRooms.some(other => getRoomEdges(other).some(otherEdge => {
                  const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1
                  const otherDx = otherEdge.x2 - otherEdge.x1, otherDy = otherEdge.y2 - otherEdge.y1
                  const length = Math.hypot(dx, dy) || 1
                  const otherLength = Math.hypot(otherDx, otherDy) || 1
                  if (Math.abs(dx * otherDy - dy * otherDx) / (length * otherLength) > 0.02) return false
                  if (Math.abs(dx * (otherEdge.y1 - edge.y1) - dy * (otherEdge.x1 - edge.x1)) / length > 2) return false
                  const ux = dx / length, uy = dy / length
                  const project = point => (point.x - edge.x1) * ux + (point.y - edge.y1) * uy
                  const start = Math.max(0, Math.min(project({ x: otherEdge.x1, y: otherEdge.y1 }), project({ x: otherEdge.x2, y: otherEdge.y2 })))
                  const end = Math.min(length, Math.max(project({ x: otherEdge.x1, y: otherEdge.y1 }), project({ x: otherEdge.x2, y: otherEdge.y2 })))
                  return end - start > 2
                }))
                const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
                return (
                  <g key={room.id} data-floorplan-object="true" onPointerEnter={() => setHoveredRoomEdge({ roomId: room.id, edgeIndex: null })} onPointerLeave={() => setHoveredRoomEdge(current => current?.roomId === room.id ? null : current)} onPointerDown={event => beginObjectDrag('room', room, event)} onClick={event => event.stopPropagation()}>
                    <polygon points={pointString} fill={active ? 'var(--bg-hover)' : 'var(--bg-subtle)'} stroke="none" />

                    {edges.map(edge => {
                      const edgeOpenings = openings.filter(opening => opening.wallType !== 'internal' && !Number.isInteger(opening.internalWallIndex) && (Number.isInteger(opening.edgeIndex) ? opening.edgeIndex : ({ top: 0, right: 1, bottom: 2, left: 3 }[opening.side] ?? 2)) === edge.edgeIndex)
                      return getOpeningSegments(edge.length, edgeOpenings).map((segment, index) => {
                        const ux = (edge.x2 - edge.x1) / (edge.length || 1)
                        const uy = (edge.y2 - edge.y1) / (edge.length || 1)
                        return <line key={edge.edgeIndex + '-' + index} x1={edge.x1 + ux * segment.start} y1={edge.y1 + uy * segment.start} x2={edge.x1 + ux * segment.end} y2={edge.y1 + uy * segment.end} stroke={active ? 'var(--text)' : 'var(--border-strong)'} strokeWidth={active ? 3.5 : 2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      })
                    })}
                    {getRoomInternalWalls(room).map((wall, index) => {
                      const metrics = getWallMetrics(wall)
                      const wallOpenings = openings.filter(opening => opening.wallType === 'internal' && opening.internalWallIndex === index)
                      return (
                        <g key={`internal-wall-${index}`}>
                          {getOpeningSegments(metrics.length, wallOpenings).map((segment, segmentIndex) => (
                            <line key={segmentIndex}
                              x1={wall.x1 + metrics.ux * segment.start} y1={wall.y1 + metrics.uy * segment.start}
                              x2={wall.x1 + metrics.ux * segment.end} y2={wall.y1 + metrics.uy * segment.end}
                              stroke={active ? 'var(--text)' : 'var(--border-strong)'} strokeWidth={active ? 3.5 : 2.5}
                              vectorEffect="non-scaling-stroke" pointerEvents="none" />
                          ))}
                          {active && <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                            stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{ cursor: 'pointer' }}
                            onPointerDown={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id })
                              setSelected({ type: 'room', id: room.id })
                              setSelectedRoomEdge({ roomId: room.id, internalWallIndex: index, edgeIndex: null })
                              setTool('select')
                            }}
                            onClick={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              setSelectedRoomEdge({ roomId: room.id, internalWallIndex: index, edgeIndex: null })
                            }} />}
                        </g>
                      )
                    })}
                    <text x={bounds.x + 8} y={bounds.y - 18} fill="var(--text)" fontSize="18" fontWeight="600" pointerEvents="none" paintOrder="stroke" stroke="var(--bg)" strokeWidth="3">
                      {room.label || 'Room'}
                    </text>
                    {Number.isFinite(Number(room.ceilingHeight)) && Number(room.ceilingHeight) > 0 && (
                      <text x={bounds.x + 8} y={bounds.y - 38} fill="var(--text-muted)" fontSize="12" pointerEvents="none" paintOrder="stroke" stroke="var(--bg)" strokeWidth="3">
                        {'Tinggi ' + Number(room.ceilingHeight).toFixed(1) + ' m'}
                      </text>
                    )}
                    {showRoomDimensions && (() => {
                      const bounds = getRoomBounds(room)
                      const dimensionLayouts = getRoomDimensionLayouts(room, edges)
                      // Connected Rooms form one dimension group: compute a single outer
                      // bounding box for their overall measurements, rather than drawing
                      // each Room's total across the shared wall/openings.
                      const connectedRoomGroup = (() => {
                        const byId = new Map(layout.rooms.map(candidate => [candidate.id, candidate]))
                        const visited = new Set([room.id])
                        const queue = [room.id]
                        while (queue.length) {
                          const current = byId.get(queue.shift())
                          ;(current?.connectedRoomIds || []).forEach(id => {
                            if (byId.has(id) && !visited.has(id)) {
                              visited.add(id)
                              queue.push(id)
                            }
                          })
                        }
                        return [...visited].map(id => byId.get(id)).filter(Boolean)
                      })()
                      const connectedGroupPoints = connectedRoomGroup.flatMap(getRoomPoints)
                      const connectedBounds = connectedGroupPoints.length
                        ? {
                            x: Math.min(...connectedGroupPoints.map(point => point.x)),
                            y: Math.min(...connectedGroupPoints.map(point => point.y)),
                            width: Math.max(...connectedGroupPoints.map(point => point.x)) - Math.min(...connectedGroupPoints.map(point => point.x)),
                            height: Math.max(...connectedGroupPoints.map(point => point.y)) - Math.min(...connectedGroupPoints.map(point => point.y)),
                          }
                        : bounds
                      const hasConnectedRooms = connectedRoomGroup.length > 1
                      const isDimensionGroupActive = active && hasConnectedRooms
                      const isTotalDimensionOwner = !hasConnectedRooms || room.id === [...connectedRoomGroup].map(item => item.id).sort()[0]
                      const totalBounds = bounds
                      const groupTotalBounds = hasConnectedRooms ? connectedBounds : null
                      const visibleDimensionLayouts = dimensionLayouts
                      const maxHorizontalLevel = Math.max(0, ...dimensionLayouts.filter(item => item.sideKey.startsWith('h-')).map(item => item.dimension.level))
                      const maxVerticalLevel = Math.max(0, ...dimensionLayouts.filter(item => item.sideKey.startsWith('v-')).map(item => item.dimension.level))
                      // A connected group must reserve space for every segment lane across all member Rooms.
                      // Overall dimensions sit outside the furthest segment lane, without changing measured values.
                      const groupDimensionLayouts = connectedRoomGroup.flatMap(candidate => getRoomDimensionLayouts(candidate, getRoomEdges(candidate)))
                      const groupMaxHorizontalLevel = Math.max(0, ...groupDimensionLayouts.filter(item => item.sideKey.startsWith('h-')).map(item => item.dimension.level))
                      const groupMaxVerticalLevel = Math.max(0, ...groupDimensionLayouts.filter(item => item.sideKey.startsWith('v-')).map(item => item.dimension.level))
                      const showIndividualTotals = !hasConnectedRooms
                      // Always show overall length and width for standalone rooms,
                      // even when the total equals one full wall. Totals are useful metadata.
                      const showHorizontalTotal = showIndividualTotals
                      const showVerticalTotal = showIndividualTotals
                      const horizontalTotalY = totalBounds.y - 112 - maxHorizontalLevel * 30
                      const verticalTotalX = totalBounds.x + totalBounds.width + 112 + maxVerticalLevel * 30
                      const groupHorizontalTotalY = groupTotalBounds ? groupTotalBounds.y - 160 - groupMaxHorizontalLevel * 30 : 0
                      const groupVerticalTotalX = groupTotalBounds ? groupTotalBounds.x + groupTotalBounds.width + 160 + groupMaxVerticalLevel * 30 : 0
                      // If a full-height outer wall differs from group bounds only by a tiny alignment sliver,
                      // use the wall's actual span for the total dimension instead of reporting the sliver.
                      const groupFullHeightEdge = groupTotalBounds && groupDimensionLayouts
                        .filter(item => Math.abs(item.edge.x2 - item.edge.x1) < 1 && Math.abs(item.edge.length - groupTotalBounds.height) <= 5)
                        .sort((a, b) => b.edge.length - a.edge.length)[0]?.edge
                      const groupVerticalStartY = groupFullHeightEdge ? Math.min(groupFullHeightEdge.y1, groupFullHeightEdge.y2) : groupTotalBounds?.y
                      const groupVerticalEndY = groupFullHeightEdge ? Math.max(groupFullHeightEdge.y1, groupFullHeightEdge.y2) : (groupTotalBounds ? groupTotalBounds.y + groupTotalBounds.height : 0)
                      const groupVerticalMeasuredHeight = groupVerticalEndY - groupVerticalStartY
                      return <g pointerEvents="none" opacity={active ? 1 : 0.58}>
                        {visibleDimensionLayouts.map(({ edge, dimension: d }) => {
                          const label = (edge.length / 100).toFixed(2) + ' m'
                          return <g key={'dimension-' + edge.edgeIndex}>
                            <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            <path d={'M ' + d.x1 + ' ' + d.y1 + ' L ' + (d.x1 + (d.y2 - d.y1) * 0.012) + ' ' + (d.y1 - (d.x2 - d.x1) * 0.012) + ' L ' + (d.x1 + (d.x2 - d.x1) * 0.025) + ' ' + (d.y1 + (d.y2 - d.y1) * 0.025) + ' Z'} fill="var(--text-muted)" />
                            <path d={'M ' + d.x2 + ' ' + d.y2 + ' L ' + (d.x2 - (d.y2 - d.y1) * 0.012) + ' ' + (d.y2 + (d.x2 - d.x1) * 0.012) + ' L ' + (d.x2 - (d.x2 - d.x1) * 0.025) + ' ' + (d.y2 - (d.y2 - d.y1) * 0.025) + ' Z'} fill="var(--text-muted)" />
                            <text x={d.mx} y={d.my - 5} textAnchor="middle" fontSize="11" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke">{label}</text>
                          </g>
                        })}
                        {showHorizontalTotal && <>
                          <g stroke="var(--text-muted)" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
                            <line x1={totalBounds.x} y1={horizontalTotalY} x2={totalBounds.x + totalBounds.width} y2={horizontalTotalY} />
                            <line x1={totalBounds.x} y1={horizontalTotalY - 6} x2={totalBounds.x} y2={horizontalTotalY + 6} />
                            <line x1={totalBounds.x + totalBounds.width} y1={horizontalTotalY - 6} x2={totalBounds.x + totalBounds.width} y2={horizontalTotalY + 6} />
                          </g>
                          <text x={totalBounds.x + totalBounds.width / 2} y={horizontalTotalY - 8} textAnchor="middle" fontSize="12" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke">{(totalBounds.width / 100).toFixed(2) + ' m total'}</text>
                        </>}
                        {hasConnectedRooms && isTotalDimensionOwner && groupTotalBounds && <>
                          <g stroke="var(--text-muted)" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
                            <line x1={groupTotalBounds.x} y1={groupHorizontalTotalY} x2={groupTotalBounds.x + groupTotalBounds.width} y2={groupHorizontalTotalY} />
                            <line x1={groupTotalBounds.x} y1={groupHorizontalTotalY - 6} x2={groupTotalBounds.x} y2={groupHorizontalTotalY + 6} />
                            <line x1={groupTotalBounds.x + groupTotalBounds.width} y1={groupHorizontalTotalY - 6} x2={groupTotalBounds.x + groupTotalBounds.width} y2={groupHorizontalTotalY + 6} />
                            <line x1={groupVerticalTotalX} y1={groupVerticalStartY} x2={groupVerticalTotalX} y2={groupVerticalEndY} />
                            <line x1={groupVerticalTotalX - 6} y1={groupVerticalStartY} x2={groupVerticalTotalX + 6} y2={groupVerticalStartY} />
                            <line x1={groupVerticalTotalX - 6} y1={groupVerticalEndY} x2={groupVerticalTotalX + 6} y2={groupVerticalEndY} />
                          </g>
                          <text x={groupTotalBounds.x + groupTotalBounds.width / 2} y={groupHorizontalTotalY - 8} textAnchor="middle" fontSize="12" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke">{(groupTotalBounds.width / 100).toFixed(2) + ' m total gabungan'}</text>
                          <text x={groupVerticalTotalX + 12} y={groupVerticalStartY + groupVerticalMeasuredHeight / 2} textAnchor="middle" fontSize="12" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke" transform={'rotate(90 ' + (groupVerticalTotalX + 12) + ' ' + (groupVerticalStartY + groupVerticalMeasuredHeight / 2) + ')'}>{(groupVerticalMeasuredHeight / 100).toFixed(2) + ' m total gabungan'}</text>
                        </>}
                        {showVerticalTotal && <>
                          <g stroke="var(--text-muted)" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
                            <line x1={verticalTotalX} y1={totalBounds.y} x2={verticalTotalX} y2={totalBounds.y + totalBounds.height} />
                            <line x1={verticalTotalX - 6} y1={totalBounds.y} x2={verticalTotalX + 6} y2={totalBounds.y} />
                            <line x1={verticalTotalX - 6} y1={totalBounds.y + totalBounds.height} x2={verticalTotalX + 6} y2={totalBounds.y + totalBounds.height} />
                          </g>
                          <text x={verticalTotalX + 12} y={totalBounds.y + totalBounds.height / 2} textAnchor="middle" fontSize="12" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke" transform={'rotate(90 ' + (verticalTotalX + 12) + ' ' + (totalBounds.y + totalBounds.height / 2) + ')'}>{(totalBounds.height / 100).toFixed(2) + ' m total'}</text>
                        </>}
                      </g>
                    })()}
                    {active && edges.map(edge => <line key={'edge-hit-' + edge.edgeIndex} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} onPointerEnter={() => setHoveredRoomEdge(current => current?.roomId === room.id ? current : current)} onClick={event => { event.preventDefault(); event.stopPropagation(); setHoveredRoomEdge({ roomId: room.id, edgeIndex: edge.edgeIndex }); applyEntitySelection([{ type: 'room', id: room.id }], { type: 'room', id: room.id }); setSelected({ type: 'room', id: room.id }) }} onPointerDown={event => { if (event.detail > 1) addRoomVertexOnEdge(room, edge.edgeIndex, event); else beginRoomEdgeDrag(room, edge.edgeIndex, event) }} onDoubleClick={event => addRoomVertexOnEdge(room, edge.edgeIndex, event)} />)}
                    {active && points.map((point, index) => (
                      <circle key={'vertex-' + index} cx={point.x} cy={point.y} r="6" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }} onPointerDown={event => beginRoomVertexDrag(room, index, event)} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); setRoomVertexPrompt({ roomId: room.id, vertexIndex: index, point: { ...point } }) }} />
                    ))}
                    {active && edges.map(edge => <circle key={'edge-' + edge.edgeIndex} cx={(edge.x1 + edge.x2) / 2} cy={(edge.y1 + edge.y2) / 2} r="3.5" fill="var(--text-muted)" stroke="var(--bg)" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
                    {openings.map(opening => {
                      const placement = getRoomOpeningPlacement(room, opening)
                      const openingWidth = Math.min(Number(opening.width ?? 48), placement.length)
                      return (
                        <g key={opening.id} transform={'translate(' + placement.x + ' ' + placement.y + ') rotate(' + placement.angle + ')'} data-floorplan-object="true" style={{ cursor: 'grab' }} onPointerDownCapture={event => beginOpeningDrag('room', room, opening, event)} onClick={event => event.stopPropagation()}>
                          <rect x={-openingWidth / 2} y="-7" width={openingWidth} height="14" fill="transparent" pointerEvents="all" />
                          <text x="0" y="-12" textAnchor="middle" fontSize="10" fontWeight="600" fill={opening.type !== 'window' ? '#fbbf24' : '#7dd3fc'} stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" pointerEvents="none" transform={'rotate(' + (-placement.angle) + ' 0 -12)'}>{openingLabel(opening)}</text>
                          
                          {opening.type === 'door' ? (
                            <DoorSwingSymbol opening={opening} width={openingWidth} />
                          ) : opening.type === 'doorway' ? null : (
                             <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' -4 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 0 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 4 H ' + (openingWidth / 2)} />
                              <path d={'M ' + (-openingWidth / 2) + ' -7 V 7 M ' + (openingWidth / 2) + ' -7 V 7'} />
                            </g>
                          )}
                        </g>
                      )
                    })}
                  </g>
                )
              })}

              {layout.walls.map(wall => {
                const metrics = getWallMetrics(wall)
                const length = metrics.length
                const openings = wall.openings || []
                const active = selected?.type === 'wall' && selected.id === wall.id
                const groupSelected = selectedItems.some(entry => entry.type === 'wall' && entry.id === wall.id)
                const wallAngle = metrics.angle
                const dimensionOffset = Math.max(22, (Number(wall.thickness) || 6) + 16)
                const dimensionX1 = wall.x1 - metrics.uy * dimensionOffset
                const dimensionY1 = wall.y1 + metrics.ux * dimensionOffset
                const dimensionX2 = wall.x2 - metrics.uy * dimensionOffset
                const dimensionY2 = wall.y2 + metrics.ux * dimensionOffset
                const showWallDimension = showRoomDimensions && (active || hoveredRoomEdge?.wallId === wall.id)
                return (
                  <g key={wall.id} data-floorplan-object="true" onPointerEnter={() => setHoveredRoomEdge({ wallId: wall.id })} onPointerLeave={() => setHoveredRoomEdge(current => current?.wallId === wall.id ? null : current)} onPointerDown={event => beginObjectDrag('wall', wall, event)} onClick={event => event.stopPropagation()}>
                    {getOpeningSegments(length, openings).map((segment, index) => (
                      <line
                        key={'wall-segment-' + index}
                        x1={wall.x1 + metrics.ux * segment.start}
                        y1={wall.y1 + metrics.uy * segment.start}
                        x2={wall.x1 + metrics.ux * segment.end}
                        y2={wall.y1 + metrics.uy * segment.end}
                        stroke={active ? 'var(--text)' : groupSelected ? 'var(--accent)' : 'var(--border-strong)'}
                        strokeWidth={active ? (wall.thickness || 6) + 2 : groupSelected ? (wall.thickness || 6) + 1 : (wall.thickness || 6)}
                        strokeLinecap="square"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <line x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2}
                      stroke="transparent" strokeWidth={Math.max(6, Number(wall.thickness) || 6)} vectorEffect="non-scaling-stroke" />
                    {openings.map(opening => {
                      const center = clamp(opening.offset, 0, 1) * length
                      const openingWidth = Math.min(Number(opening.width ?? 48), length)
                      return (
                        <g
                          key={opening.id}
                          transform={'translate(' + (wall.x1 + metrics.ux * center) + ' ' + (wall.y1 + metrics.uy * center) + ') rotate(' + wallAngle + ')'}
                          data-floorplan-object="true"
                          style={{ cursor: 'grab' }}
                          onPointerDownCapture={event => beginOpeningDrag('wall', wall, opening, event)}
                          onClick={event => event.stopPropagation()}
                        >
                          <rect x={-openingWidth / 2} y="-7" width={openingWidth} height="14" fill="transparent" pointerEvents="all" />
                          <text x="0" y="-12" textAnchor="middle" fontSize="10" fontWeight="600" fill={opening.type !== 'window' ? '#fbbf24' : '#7dd3fc'} stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" pointerEvents="none" transform={'rotate(' + (-wallAngle) + ' 0 -12)'}>
                            {openingLabel(opening)}
                           </text>
                           {opening.type === 'door' && <text x="0" y="25" textAnchor="middle" fontSize="9" fontWeight="600" fill="#fbbf24" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" pointerEvents="none" transform={'rotate(' + (-wallAngle) + ' 0 25)'}>{'Daun pintu ' + (Number(opening.width ?? 48) / 100).toFixed(2) + ' m'}</text>}
                           {opening.type === 'door' ? (
                            <DoorSwingSymbol opening={opening} width={openingWidth} />
                          ) : opening.type === 'doorway' ? null : (
                             <g fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                              <path d={'M ' + (-openingWidth / 2) + ' -4 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 0 H ' + (openingWidth / 2) + ' M ' + (-openingWidth / 2) + ' 4 H ' + (openingWidth / 2)} />
                              <path d={'M ' + (-openingWidth / 2) + ' -7 V 7 M ' + (openingWidth / 2) + ' -7 V 7'} />
                            </g>
                          )}
                        </g>
                      )                    })}
                    {showWallDimension && (
                      <g pointerEvents="none">
                        <line x1={dimensionX1} y1={dimensionY1} x2={dimensionX2} y2={dimensionY2} stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        <line x1={dimensionX1 - metrics.ux * 5} y1={dimensionY1 - metrics.uy * 5} x2={dimensionX1 + metrics.ux * 5} y2={dimensionY1 + metrics.uy * 5} stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        <line x1={dimensionX2 - metrics.ux * 5} y1={dimensionY2 - metrics.uy * 5} x2={dimensionX2 + metrics.ux * 5} y2={dimensionY2 + metrics.uy * 5} stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        <text x={(dimensionX1 + dimensionX2) / 2} y={(dimensionY1 + dimensionY2) / 2 - 6} textAnchor="middle" fontSize="12" fill="var(--text)" stroke="var(--bg)" strokeWidth="5" paintOrder="stroke">{formatMeters(length)}</text>
                      </g>
                    )}
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
                    fill={getLightConeColors(light).fill}
                    fillOpacity={selected?.type === 'light' && selected.id === light.id ? 0.26 : 0.18}
                    stroke={getLightConeColors(light).stroke}
                    strokeOpacity={selected?.type === 'light' && selected.id === light.id ? 1 : 0.9}
                    strokeWidth={selected?.type === 'light' && selected.id === light.id ? 1.6 : 1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}

              {[
                ...layout.props.map(item => ({ ...item, _kind: 'prop' })),
                ...layout.actors.map(item => ({ ...item, _kind: 'actor' })),
                ...layout.cameras.filter(item => !shotFocusMode || !activeFloorplanShot || item.shotId === activeFloorplanShot.id).map(item => ({ ...item, _kind: 'camera' })),
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
                const movementWaypoints = showPath ? (object.path || []) : []
                const points = [
                  { x: object.x, y: object.y },
                  ...movementWaypoints,
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
                    {movementWaypoints.length > 0 && (() => {
                      const endpoint = movementWaypoints[movementWaypoints.length - 1]
                      const endpointName = type === 'actor'
                        ? (object.label || 'Actor')
                        : type === 'camera' || type === 'light'
                          ? objectName(type, object)
                          : type === 'prop'
                            ? (object.label || 'Prop')
                            : object.label || (type === 'door' ? 'Door' : type === 'window' ? 'Window' : type)
                      return (
                        <g
                          key="movement-path-end-object"
                          data-floorplan-path-end-object="true"
                          transform={'translate(' + endpoint.x + ' ' + endpoint.y + ')'}
                          pointerEvents="all"
                          opacity={active ? 1 : 0.72}
                          style={{ cursor: object.locked ? 'default' : 'grab' }}
                          onPointerDown={event => beginWaypointDrag(type, object, movementWaypoints.length - 1, event)}
                          onClick={event => event.stopPropagation()}
                        >
                          {type === 'actor' ? (
                            <g transform={'rotate(' + (object.angle || 0) + ') scale(0.28)'} fill={getObjectColor(type, object)} fillOpacity="0.12" stroke={getObjectColor(type, object)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                              <path d="M-22 -6 C-30 -10 -37 -6 -40 2 C-43 12 -36 22 -27 23 C-21 31 -10 34 0 34 C10 34 21 31 27 23 C36 22 43 12 40 2 C37 -6 30 -10 22 -6" />
                              <path d="M0 -31 C-17 -31 -22 -17 -21 -6 C-20 5 -15 13 -8 15 C-5 16 -4 20 0 21 C4 20 5 16 8 15 C15 13 20 5 21 -6 C22 -17 17 -31 0 -31 Z" />
                              <path d="M-18 0 C-12 -5 -7 6 0 6 C7 6 12 -5 18 0" />
                              <path d="M-25 12 C-28 15 -28 19 -25 23 M25 12 C28 15 28 19 25 23" />
                            </g>
                          ) : type === 'camera' ? (
                            <>
                              {cameraFov && (
                                <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                                  <path
                                    d={cameraFov.widePath}
                                    fill={getCameraFovColor(object)}
                                    fillOpacity={active ? 0.2 : 0.12}
                                    stroke={getCameraFovColor(object)}
                                    strokeOpacity={active ? 1 : 0.88}
                                    strokeWidth={active ? 1.6 : 1.2}
                                    vectorEffect="non-scaling-stroke"
                                  />
                                  {cameraFov.narrowPath && (
                                    <path
                                      d={cameraFov.narrowPath}
                                      fill="var(--bg)"
                                      fillOpacity="0.28"
                                      stroke={getCameraFovColor(object)}
                                      strokeOpacity={active ? 1 : 0.9}
                                      strokeWidth="1.2"
                                      strokeDasharray="5 4"
                                      vectorEffect="non-scaling-stroke"
                                    />
                                  )}
                                </g>
                              )}
                              <g transform={'rotate(' + (object.angle || 0) + ') scale(0.42)'} fill="var(--bg)" stroke={getObjectColor(type, object)} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                                <path d="M9 -9 L33 -20 L33 20 L9 9 Z" />
                                <rect x="-29" y="-15" width="40" height="30" rx="6" />
                              </g>
                            </>
                          ) : type === 'light' ? (
                            <g transform={'rotate(' + (90 + (object.angle || 0)) + ') scale(0.48)'} fill="var(--bg)" stroke={getObjectColor(type, object)} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                              <path d="M-13 -8 L-8 -11 L3 -11 L11 -7 L11 7 L3 11 L-8 11 L-13 8 Z" />
                              <path d="M-13 -5 L-18 -9 M-13 5 L-18 9" fill="none" strokeLinecap="round" />
                              <circle cx="7" cy="0" r="4.2" fill="var(--text)" stroke="none" />
                              <path d="M-2 -6 L-2 6" strokeOpacity="0.65" fill="none" />
                            </g>
                          ) : type === 'prop' ? (
                            <g transform={'rotate(' + (object.angle || 0) + ')'} fill="var(--bg-subtle)" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                              <rect x={-object.width / 2} y={-object.height / 2} width={object.width} height={object.height} rx={object.propType === 'Sofa' ? 8 : 2} />
                              {object.propType === 'Chair' ? (
                                <path d={'M ' + (-object.width * 0.32) + ' ' + (-object.height * 0.25) + ' H ' + (object.width * 0.32) + ' V ' + (object.height * 0.28)} fill="none" />
                              ) : object.propType === 'Bed' ? (
                                <path d={'M ' + (-object.width / 2 + 4) + ' ' + (-object.height / 2 + 9) + ' H ' + (object.width / 2 - 4)} fill="none" />
                              ) : null}
                            </g>
                          ) : (
                            <FloorplanObjectIcon type={type} size={22} />
                          )}
                          <text
                            x="0"
                            y={type === 'actor' ? 40 : type === 'camera' ? 46 : type === 'light' ? 35 : type === 'prop' ? Math.max(22, Number(object.height) / 2 + 15) : 30}
                            textAnchor="middle"
                            fontSize={type === 'actor' || type === 'camera' ? 15 : 13}
                            fontWeight={type === 'camera' ? 600 : 500}
                            fill="var(--text)"
                            stroke="var(--bg)"
                            strokeWidth="4"
                            paintOrder="stroke"
                          >
                            {showObjectLabels && endpointName}
                          </text>
                        </g>
                      )
                    })()}
                    {(showPath ? (object.path || []) : []).map((point, index) => {
                      // The start is represented by the original object icon and the final
                      // waypoint is represented by the matching endpoint icon+label above.
                      // Do not paint a waypoint handle over either object's face/center.
                      if (
                        index === movementWaypoints.length - 1
                        || Math.hypot(point.x - object.x, point.y - object.y) < 0.5
                      ) return null
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
                      {type === 'camera' && cameraFov && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="none">
                          <path
                            d={cameraFov.widePath}
                            fill={getCameraFovColor(object)}
                            fillOpacity={active ? 0.2 : 0.12}
                            stroke={getCameraFovColor(object)}
                            strokeOpacity={active ? 1 : 0.88}
                            strokeWidth={active ? 1.6 : 1.2}
                            vectorEffect="non-scaling-stroke"
                          />
                          {cameraFov.narrowPath && (
                            <path
                              d={cameraFov.narrowPath}
                              fill="var(--bg)"
                              fillOpacity="0.28"
                              stroke={getCameraFovColor(object)}
                              strokeOpacity={active ? 1 : 0.9}
                              strokeWidth="1.2"
                              strokeDasharray="5 4"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </g>
                      )}
                      {type === 'camera' && (
                        <g transform={'rotate(' + (object.angle || 0) + ') scale(0.42)'} pointerEvents="visiblePainted">
                          <path d="M9 -9 L33 -20 L33 20 L9 9 Z" fill="var(--bg)" stroke={getObjectColor(type, object)} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                          <rect x="-29" y="-15" width="40" height="30" rx="6" fill="var(--bg)" stroke={getObjectColor(type, object)} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
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
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="visiblePainted" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                          <path d={'M ' + (-object.width / 2) + ' 0 H ' + (object.width / 2)} strokeWidth="5" />
                          <path d={'M ' + (-object.width / 2) + ' 0 V ' + (-object.width) + ' A ' + object.width + ' ' + object.width + ' 0 0 1 ' + (object.width / 2) + ' 0'} strokeDasharray="4 4" strokeOpacity="0.72" />
                          <path d={'M ' + (-object.width / 2) + ' 0 L ' + (-object.width / 2) + ' ' + (-object.width)} />
                        </g>
                      )}
                      {type === 'window' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="visiblePainted" fill="none" stroke="var(--text)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                          <path d={'M ' + (-object.width / 2) + ' ' + (-Math.max(5, object.height / 2)) + ' H ' + (object.width / 2) + ' M ' + (-object.width / 2) + ' 0 H ' + (object.width / 2) + ' M ' + (-object.width / 2) + ' ' + Math.max(5, object.height / 2) + ' H ' + (object.width / 2)} />
                          <path d={'M ' + (-object.width / 2) + ' ' + (-Math.max(5, object.height / 2) - 3) + ' V ' + (Math.max(5, object.height / 2) + 3) + ' M ' + (object.width / 2) + ' ' + (-Math.max(5, object.height / 2) - 3) + ' V ' + (Math.max(5, object.height / 2) + 3)} />
                        </g>
                      )}
                      {type === 'prop' && (
                        <g transform={'rotate(' + (object.angle || 0) + ')'} pointerEvents="visiblePainted" fill="var(--bg-subtle)" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
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
                        <g transform={'rotate(' + (object.angle || 0) + ') scale(0.28)'} pointerEvents="visiblePainted">
                          <g fill={getObjectColor(type, object)} fillOpacity="0.12" stroke={getObjectColor(type, object)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                            <path d="M-22 -6 C-30 -10 -37 -6 -40 2 C-43 12 -36 22 -27 23 C-21 31 -10 34 0 34 C10 34 21 31 27 23 C36 22 43 12 40 2 C37 -6 30 -10 22 -6" />
                            <path d="M0 -31 C-17 -31 -22 -17 -21 -6 C-20 5 -15 13 -8 15 C-5 16 -4 20 0 21 C4 20 5 16 8 15 C15 13 20 5 21 -6 C22 -17 17 -31 0 -31 Z" />
                            <path d="M-18 0 C-12 -5 -7 6 0 6 C7 6 12 -5 18 0" />
                            <path d="M-25 12 C-28 15 -28 19 -25 23 M25 12 C28 15 28 19 25 23" />                          </g>
                        </g>
                      )}
                      {type === 'actor' && showObjectLabels && (
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
                          transform={'rotate(' + (90 + (object.angle || 0)) + ') scale(0.48)'}
                          pointerEvents="visiblePainted"
                          fill="var(--bg)"
                          stroke={getObjectColor(type, object)}
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
                      {type === 'camera' && showObjectLabels && (
                        <text x="0" y="46" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
                          {objectName('camera', object)}
                        </text>
                      )}
                      {type === 'light' && showObjectLabels && (
                        <text x="0" y="35" textAnchor="middle" fontSize="13" fontWeight="500" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
                          {objectName('light', object)}
                        </text>
                      )}
                      {['door', 'window', 'prop'].includes(type) && (type !== 'prop' || showObjectLabels) && (
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
                          {object.label || (type === 'door' ? 'Door' : type === 'window' ? 'Window' : 'Prop')}
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

              {tool === 'room' && roomDrawPoints.length > 0 && previewPoint && (() => {
                const points = [...roomDrawPoints, previewPoint]
                const last = roomDrawPoints[roomDrawPoints.length - 1]
                const length = Math.hypot(previewPoint.x - last.x, previewPoint.y - last.y)
                const pointString = points.map(point => point.x + ',' + point.y).join(' ')
                const closeTolerance = 15 * viewBox.width / Math.max(1, canvasSize.width)
                const close = Math.hypot(previewPoint.x - roomDrawPoints[0].x, previewPoint.y - roomDrawPoints[0].y) <= closeTolerance
                return <g pointerEvents="none">
                  {roomSnapGuides.map((guide, index) => <line key={'snap-guide-' + index}
                    x1={guide.axis === 'horizontal' ? viewBox.x : guide.x}
                    y1={guide.axis === 'vertical' ? viewBox.y : guide.y}
                    x2={guide.axis === 'horizontal' ? viewBox.x + viewBox.width : guide.x}
                    y2={guide.axis === 'vertical' ? viewBox.y + viewBox.height : guide.y}
                    stroke="var(--accent)" strokeWidth="1" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
                  <polyline points={pointString} fill={roomDrawPoints.length >= 2 ? 'var(--bg-hover)' : 'none'} fillOpacity="0.45" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /><circle cx={roomDrawPoints[0].x} cy={roomDrawPoints[0].y} r={close ? 9 : 5} fill={close ? 'var(--accent)' : 'var(--bg)'} stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={(last.x + previewPoint.x) / 2 + 6} y={(last.y + previewPoint.y) / 2 - 8} fontSize="13" fill="var(--text)" stroke="var(--bg)" strokeWidth="4" paintOrder="stroke">{(length / 100).toFixed(2) + ' m'}</text></g>
              })()}
              {tool === 'room' && roomLengthInputOpen && previewPoint && (
                <foreignObject x={previewPoint.x + 10} y={previewPoint.y + 10} width="150" height="48" style={{ overflow: 'visible', pointerEvents: 'all' }}>
                  <div xmlns="http://www.w3.org/1999/xhtml" style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '5px', color: 'var(--text)', pointerEvents: 'all' }} onPointerDown={event => event.stopPropagation()}>
                    <input autoFocus aria-label="Panjang garis dalam meter" type="number" min="0.01" step="0.01" value={roomLengthInput} onChange={event => setRoomLengthInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); confirmManualRoomLength() } if (event.key === 'Escape') { event.preventDefault(); setRoomLengthInputOpen(false) } }} style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px' }} />
                  </div>
                </foreignObject>
              )}
              {roomDrawMessage && tool === 'room' && <text x={viewBox.x + 16} y={viewBox.y + 28} fill="var(--text)" fontSize="13" pointerEvents="none">{roomDrawMessage}</text>}
              {drawStart && previewPoint && tool === 'wall' && (
                <line x1={drawStart.x} y1={drawStart.y} x2={previewPoint.x} y2={previewPoint.y}
                  stroke="var(--text)" strokeWidth="3" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )}
              {selectionBox && (
                <rect
                  x={selectionBox.x}
                  y={selectionBox.y}
                  width={selectionBox.width}
                  height={selectionBox.height}
                  fill="var(--accent)"
                  fillOpacity="0.10"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              <g pointerEvents="none">
                {roomSnapGuides.map((guide, index) => <line key={'snap-guide-active-' + index}
                  x1={guide.axis === 'horizontal' ? viewBox.x : guide.x}
                  y1={guide.axis === 'vertical' ? viewBox.y : guide.y}
                  x2={guide.axis === 'horizontal' ? viewBox.x + viewBox.width : guide.x}
                  y2={guide.axis === 'vertical' ? viewBox.y + viewBox.height : guide.y}
                  stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
              </g>
            </svg>
            <div className="floorplan-view-controls" role="group" aria-label="Kontrol tampilan denah">
              <button type="button" className="floorplan-view-control-button" onClick={() => zoomCanvas(1.25)} disabled={viewBox.width >= MAP_WIDTH * 2.5} title="Perkecil tampilan" aria-label="Perkecil tampilan"><Minus size={16} /></button>
              <span className="floorplan-zoom-level" aria-live="polite">{Math.round((MAP_WIDTH / viewBox.width) * 100)}%</span>
              <button type="button" className="floorplan-view-control-button" onClick={() => zoomCanvas(0.8)} disabled={viewBox.width <= 80} title="Perbesar tampilan" aria-label="Perbesar tampilan"><Plus size={16} /></button>
              <span className="floorplan-view-control-divider" />
              <button type="button" className="floorplan-view-control-button" onClick={resetZoom} title="Reset zoom ke 100% (1:1)" aria-label="Reset zoom ke 100 persen">1:1</button>
              <button type="button" className="floorplan-view-control-button floorplan-fit-button" onClick={fitCanvas} title="Muat seluruh denah ke kanvas" aria-label="Muat seluruh denah ke kanvas"><Maximize2 size={15} /><span>Muat denah</span></button>
            </div>
          </div>
        </div>

        <aside className="floorplan-inspector" onWheel={event => event.stopPropagation()} style={{ overscrollBehavior: 'contain' }}>
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

              <section className="floorplan-inspector-section">
                <button
                  type="button"
                  className="floorplan-opening-add"
                  aria-pressed={Boolean(selectedEntity.locked)}
                  onClick={() => updateSelected({ locked: !selectedEntity.locked })}
                  title={selectedEntity.locked ? 'Buka kunci agar objek bisa digeser atau diubah' : 'Kunci agar objek tidak bisa digeser atau diubah'}
                >
                  {selectedEntity.locked ? <Unlock size={16} /> : <Lock size={16} />}
                  {selectedEntity.locked ? 'Buka Kunci Objek' : 'Kunci Objek'}
                </button>
              </section>

              {selectedType === 'actor' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="actor-name">Aktor</label>
                    <input id="actor-name" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Warna</div>
                    <ColorSwatchPicker
                      label="Warna aktor"
                      value={selectedEntity.color || CATEGORY_COLORS.actor}
                      onChange={color => updateSelected({ color })}
                    />
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
                  <section className="floorplan-inspector-section floorplan-camera-link-section">
                    <label htmlFor="camera-linked-shot">Tautan Shot List</label>
                    <select
                      id="camera-linked-shot"
                      className="floorplan-field"
                      value={selectedEntity.shotId || ''}
                      onChange={event => changeCameraLink(selectedEntity, event.target.value)}
                    >
                      <option value="">Belum ditautkan</option>
                      {scene.shots.filter(shot => !layout.cameras.some(camera => camera.id !== selectedEntity.id && camera.shotId === shot.id)).map(shot => (                        <option key={shot.id} value={shot.id}>{shot.num} — {shot.subject || 'Untitled shot'}</option>
                      ))}
                    </select>
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Warna kamera & FOV</div>
                    <ColorSwatchPicker
                      label="Warna kamera"
                      value={selectedEntity.color || CATEGORY_COLORS.camera}
                      onChange={color => updateSelected({ color })}
                    />
                  </section>
                  {selectedShot ? (
                    <>
                      <section className="floorplan-inspector-section floorplan-camera-fields">
                        <div className="floorplan-camera-field">
                          <label htmlFor="camera-subject">Subjek</label>
                          <input
                            id="camera-subject"
                            className="floorplan-field"
                            value={selectedShot.subject || ''}
                            maxLength={1000}
                            onChange={event => updateLinkedShot('subject', event.target.value)}
                            placeholder="Subjek shot"
                          />
                        </div>
                        <div className="floorplan-camera-field">
                          <label htmlFor="camera-body">Kamera</label>
                          <input
                            id="camera-body"
                            className="floorplan-field"
                            value={selectedShot.camera || ''}
                            maxLength={200}
                            onChange={event => updateLinkedShot('camera', event.target.value)}
                            placeholder="Body kamera"
                          />
                        </div>
                        <div className="floorplan-camera-field">
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
                        </div>
                        <div className="floorplan-camera-field">
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
                        </div>
                        <div className="floorplan-camera-field floorplan-camera-field-wide">
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
                        </div>
                      </section>

                      <section className="floorplan-inspector-section floorplan-shotlist-chip-section">
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
                      </section>

                      <section className="floorplan-inspector-section floorplan-shotlist-chip-section">
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
                  {selectedEntity.mergeParts?.target && selectedEntity.mergeParts?.moving && (
                    <section className="floorplan-inspector-section">
                      <div className="floorplan-section-title">Ruangan gabungan</div>
                      <button type="button" className="floorplan-opening-add" onClick={() => unmergeRoom(selectedEntity)} disabled={Boolean(selectedEntity.locked)} title={'Pulihkan bentuk dan posisi sebelum digabungkan: ' + (selectedEntity.mergeParts.target.label || 'Room') + ' + ' + (selectedEntity.mergeParts.moving.label || 'Room')}>Pisahkan ruangan gabungan</button>
                    </section>
                  )}
                  <section className="floorplan-inspector-section">
                    <label htmlFor="room-label">Nama ruang</label>
                    <input id="room-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  {Array.isArray(selectedEntity.connectedRoomIds) && selectedEntity.connectedRoomIds.some(id => layout.rooms.some(room => room.id === id)) && (
                    <section className="floorplan-inspector-section">
                      <div className="floorplan-section-title">Sambungan Room</div>
                      <button type="button" className="floorplan-opening-add" onClick={() => {
                        const connectedIds = new Set(selectedEntity.connectedRoomIds || [])
                        updateLayout(previous => ({
                          ...previous,
                          rooms: previous.rooms.map(room => {
                            if (room.id === selectedEntity.id) {
                              const next = { ...room }
                              delete next.connectedRoomIds
                              return next
                            }
                            if (!connectedIds.has(room.id)) return room
                            return { ...room, connectedRoomIds: (room.connectedRoomIds || []).filter(id => id !== selectedEntity.id) }
                          }),
                        }))
                      }} disabled={Boolean(selectedEntity.locked)}>
                        Lepaskan sambungan Room
                      </button>
                    </section>
                  )}
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Ukuran ruangan</div>
                    <div className="floorplan-dimension-grid">
                      <div className="floorplan-dimension-input">
                        <label htmlFor="room-length">Panjang (m)</label>
                        <input id="room-length" className="floorplan-field" type="number" min="0.01" max="10" step="0.01" value={(getRoomBounds(selectedEntity).width / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                          const meters = Number(event.target.value)
                          if (Number.isFinite(meters) && meters >= 0.01 && meters <= 10) {
                            const resized = resizeRoomBounds(selectedEntity, 'length', meters * 100)
                            updateLayout(previous => ({ ...previous, rooms: previous.rooms.map(room => room.id === selectedEntity.id ? resized : room) }))
                          }
                        }} />
                      </div>
                      <div className="floorplan-dimension-input">
                        <label htmlFor="room-width">Lebar (m)</label>
                        <input id="room-width" className="floorplan-field" type="number" min="0.01" max="6.5" step="0.01" value={(getRoomBounds(selectedEntity).height / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                          const meters = Number(event.target.value)
                          if (Number.isFinite(meters) && meters >= 0.01 && meters <= 6.5) {
                            const resized = resizeRoomBounds(selectedEntity, 'width', meters * 100)
                            updateLayout(previous => ({ ...previous, rooms: previous.rooms.map(room => room.id === selectedEntity.id ? resized : room) }))
                          }
                        }} />
                      </div>
                    </div>
                    <div className="floorplan-opening-actions">
                      <button type="button" disabled={Boolean(selectedEntity.locked) || selectedRoomEdge?.roomId !== selectedEntity.id} onClick={() => addRoomVertexAtEdgeMidpoint(selectedEntity)}>Tambah titik pada sisi terpilih</button>
                      <button type="button" disabled={Boolean(selectedEntity.locked) || selectedRoomVertex?.roomId !== selectedEntity.id} onClick={deleteSelectedRoomVertex}>Hapus titik terpilih</button>
                    </div>
                  </section>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="room-ceiling-height">Tinggi ruangan (m)</label>
                    <input id="room-ceiling-height" className="floorplan-field" type="number" min="1" max="10" step="0.1" placeholder="Belum diisi" value={Number.isFinite(Number(selectedEntity.ceilingHeight)) && Number(selectedEntity.ceilingHeight) > 0 ? selectedEntity.ceilingHeight : ''} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                      const value = event.target.value
                      if (value === '') {
                        updateLayout(previous => ({ ...previous, rooms: previous.rooms.map(room => {
                          if (room.id !== selectedEntity.id) return room
                          const next = { ...room }
                          delete next.ceilingHeight
                          return next
                        }) }))
                      } else {
                        const meters = Number(value)
                        if (Number.isFinite(meters) && meters >= 1 && meters <= 10) updateSelected({ ceilingHeight: meters })
                      }
                    }} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Bukaan</div>
                    <div className="floorplan-opening-actions">
                      <button className="floorplan-opening-add" onClick={() => addOpening('door')}><FloorplanObjectIcon type="door" size={18} /> Tambah pintu</button>
                       <button className="floorplan-opening-add" onClick={() => addOpening('doorway')}><FloorplanObjectIcon type="doorway" size={18} /> Tambah pintu tanpa daun</button>
                      <button className="floorplan-opening-add" onClick={() => addOpening('window')}><FloorplanObjectIcon type="window" size={18} /> Tambah jendela</button>
                    </div>
                    {(selectedEntity.openings || []).map(opening => (
                      <div className="floorplan-opening-row" key={opening.id}>
                        <span className="floorplan-opening-kind"><FloorplanObjectIcon type={opening.type} size={18} />{openingLabel(opening)}</span>
                        <button className="floorplan-icon-button" onClick={() => removeOpening(opening.id)} disabled={Boolean(selectedEntity.locked)} title="Hapus bukaan" aria-label="Hapus bukaan"><X size={15} /></button>
                        <div className="floorplan-opening-actions">
                          {(opening.type === 'door' || opening.type === 'doorway') && <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-leaf-mode'}>Model pintu</label>
                            <select id={opening.id + '-leaf-mode'} className="floorplan-field" value={opening.type === 'door' ? 'leaf' : 'no-leaf'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { type: event.target.value === 'leaf' ? 'door' : 'doorway' })}>
                              <option value="leaf">Pintu berdaun</option>
                              <option value="no-leaf">Pintu tanpa daun</option>
                            </select>
                          </div>}
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-edge'}>Dinding pemasangan</label>
                            <select id={opening.id + '-edge'} className="floorplan-field" value={opening.wallType === 'internal' && Number.isInteger(opening.internalWallIndex) ? 'internal:' + opening.internalWallIndex : 'edge:' + (Number.isInteger(opening.edgeIndex) ? opening.edgeIndex : 0)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                              const [kind, rawIndex] = event.target.value.split(':')
                              const index = Number(rawIndex)
                              updateOpening(opening.id, kind === 'internal'
                                ? { wallType: 'internal', internalWallIndex: index, edgeIndex: null }
                                : { wallType: 'perimeter', internalWallIndex: null, edgeIndex: index })
                            }}>
                              {getRoomEdges(selectedEntity).map(edge => <option key={'edge-' + edge.edgeIndex} value={'edge:' + edge.edgeIndex}>Dinding luar {edge.edgeIndex + 1}</option>)}
                              {getRoomInternalWalls(selectedEntity).map((wall, index) => <option key={'internal-' + index} value={'internal:' + index}>Dinding sambungan {index + 1}</option>)}
                            </select>
                          </div>
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-width'}>Lebar (m)</label>
                            <input id={opening.id + '-width'} className="floorplan-field" type="number" min="0" max="5.00" step="0.01" value={(Number(opening.width ?? 48) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                              const raw = event.target.value
                              if (raw.trim() === '') {
                                updateOpening(opening.id, { width: 0 })
                                return
                              }
                              const meters = Number(raw)
                              if (!Number.isFinite(meters)) return
                              updateOpening(opening.id, { width: Math.round(clamp(meters, 0, 5) * 100) })
                            }} />
                          </div>
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-height'}>Tinggi (m)</label>
                            <input id={opening.id + '-height'} className="floorplan-field" type="number" min="0" max="4.00" step="0.01" value={(Number(opening.height ?? (opening.type === 'door' ? 210 : 120)) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                              const raw = event.target.value
                              if (raw.trim() === '') {
                                updateOpening(opening.id, { height: 0 })
                                return
                              }
                              const meters = Number(raw)
                              if (!Number.isFinite(meters)) return
                              updateOpening(opening.id, { height: Math.round(clamp(meters, 0, 4) * 100) })
                            }} />
                          </div>
                          {opening.type === 'doorway' && <>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-label'}>Nama pintu</label>
                              <input id={opening.id + '-label'} className="floorplan-field" type="text" maxLength={80} value={opening.label || 'Pintu Tanpa Daun'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { label: event.target.value })} />
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-swing'}>Arah buka</label>
                              <select id={opening.id + '-swing'} className="floorplan-field" value={opening.swingDirection === 'out' ? 'out' : 'in'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { swingDirection: event.target.value })}>
                                <option value="in">Ke dalam</option>
                                <option value="out">Ke luar</option>
                              </select>
                            </div>
                          </>}
                          {opening.type === 'door' && <>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-swing'}>Arah buka</label>
                              <select id={opening.id + '-swing'} className="floorplan-field" value={opening.swingDirection === 'out' ? 'out' : 'in'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { swingDirection: event.target.value })}>
                                <option value="in">Ke dalam</option>
                                <option value="out">Ke luar</option>
                              </select>
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-door-type'}>Jenis pintu</label>
                              <select id={opening.id + '-door-type'} className="floorplan-field" value={opening.doorType === 'double' ? 'double' : 'single'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { doorType: event.target.value })}>
                                <option value="single">Single</option>
                                <option value="double">Double</option>
                              </select>
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-hinge-side'}>Engsel di sisi</label>
                              <select id={opening.id + '-hinge-side'} className="floorplan-field" value={opening.hingeSide === 'right' ? 'right' : 'left'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { hingeSide: event.target.value })}>
                                <option value="left">Kiri</option>
                                <option value="right">Kanan</option>
                              </select>
                            </div>
                          </>}
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-offset'}>Posisi (%)</label>
                            <input id={opening.id + '-offset'} className="floorplan-field" type="number" min="5" max="95" step="1" value={Math.round((Number(opening.offset) || 0.5) * 100)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                              const percent = Number(event.target.value)
                              if (!Number.isFinite(percent) || percent < 5 || percent > 95) return
                              updateOpening(opening.id, { offset: percent / 100 })
                            }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </section>
                </>
              )}

              {selectedType === 'wall' && (
                <>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Dimensi</div>
                    <div className="floorplan-dimension-grid">
                      <div className="floorplan-dimension-input">
                        <label htmlFor="wall-length">Panjang (m)</label>
                        <input id="wall-length" className="floorplan-field" type="number" min="0.01" max="20" step="0.01" value={(getWallMetrics(selectedEntity).length / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                          const meters = Number(event.target.value)
                          if (!Number.isFinite(meters) || meters < 0.01 || meters > 20) return
                          const current = getWallMetrics(selectedEntity)
                          const length = meters * 100
                          updateLayout(previous => ({
                            ...previous,
                            walls: previous.walls.map(wall => wall.id === selectedEntity.id
                              ? { ...wall, x2: wall.x1 + current.ux * length, y2: wall.y1 + current.uy * length }
                              : wall),
                          }))
                        }} />
                      </div>
                      <div className="floorplan-dimension-input">
                        <label htmlFor="wall-thickness">Lebar / tebal (m)</label>
                        <input id="wall-thickness" className="floorplan-field" type="number" min="0.01" max="1" step="0.01" value={((Number(selectedEntity.thickness) || 6) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                          const meters = Number(event.target.value)
                          if (!Number.isFinite(meters) || meters < 0.01 || meters > 1) return
                          updateLayout(previous => ({
                            ...previous,
                            walls: previous.walls.map(wall => wall.id === selectedEntity.id
                              ? { ...wall, thickness: Math.round(meters * 100) }
                              : wall),
                          }))
                        }} />
                      </div>
                    </div>
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Bukaan</div>
                    <div className="floorplan-opening-actions">
                      <button className="floorplan-opening-add" onClick={() => addOpening('door')}><FloorplanObjectIcon type="door" size={18} /> Tambah pintu</button>
                       <button className="floorplan-opening-add" onClick={() => addOpening('doorway')}><FloorplanObjectIcon type="doorway" size={18} /> Tambah pintu tanpa daun</button>
                      <button className="floorplan-opening-add" onClick={() => addOpening('window')}><FloorplanObjectIcon type="window" size={18} /> Tambah jendela</button>
                    </div>
                    {(selectedEntity.openings || []).map(opening => (
                      <div className="floorplan-opening-row" key={opening.id}>
                        <span className="floorplan-opening-kind"><FloorplanObjectIcon type={opening.type} size={18} />{openingLabel(opening)}</span>
                        <button className="floorplan-icon-button" onClick={() => removeOpening(opening.id)} disabled={Boolean(selectedEntity.locked)} title="Hapus bukaan" aria-label="Hapus bukaan"><X size={15} /></button>
                        <div className="floorplan-opening-actions">
                          {(opening.type === 'door' || opening.type === 'doorway') && <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-leaf-mode'}>Model pintu</label>
                            <select id={opening.id + '-leaf-mode'} className="floorplan-field" value={opening.type === 'door' ? 'leaf' : 'no-leaf'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { type: event.target.value === 'leaf' ? 'door' : 'doorway' })}>
                              <option value="leaf">Pintu berdaun</option>
                              <option value="no-leaf">Pintu tanpa daun</option>
                            </select>
                          </div>}
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-width'}>Lebar (m)</label>
                            <input id={opening.id + '-width'} className="floorplan-field" type="number" min="0" max="5.00" step="0.01" value={(Number(opening.width ?? 48) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                              const raw = event.target.value
                              if (raw.trim() === '') {
                                updateOpening(opening.id, { width: 0 })
                                return
                              }
                              const meters = Number(raw)
                              if (!Number.isFinite(meters)) return
                              updateOpening(opening.id, { width: Math.round(clamp(meters, 0, 5) * 100) })
                            }} />
                          </div>
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-height'}>Tinggi (m)</label>
                            <input id={opening.id + '-height'} className="floorplan-field" type="number" min="0" max="4.00" step="0.01" value={(Number(opening.height ?? (opening.type === 'door' ? 210 : 120)) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onFocus={event => event.currentTarget.select()} onChange={event => {
                              const raw = event.target.value
                              if (raw.trim() === '') {
                                updateOpening(opening.id, { height: 0 })
                                return
                              }
                              const meters = Number(raw)
                              if (!Number.isFinite(meters)) return
                              updateOpening(opening.id, { height: Math.round(clamp(meters, 0, 4) * 100) })
                            }} />
                          </div>
                          {opening.type === 'doorway' && <>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-label'}>Nama pintu</label>
                              <input id={opening.id + '-label'} className="floorplan-field" type="text" maxLength={80} value={opening.label || 'Pintu Tanpa Daun'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { label: event.target.value })} />
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-swing'}>Arah buka</label>
                              <select id={opening.id + '-swing'} className="floorplan-field" value={opening.swingDirection === 'out' ? 'out' : 'in'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { swingDirection: event.target.value })}>
                                <option value="in">Ke dalam</option>
                                <option value="out">Ke luar</option>
                              </select>
                            </div>
                          </>}
                          {opening.type === 'door' && <>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-swing'}>Arah buka</label>
                              <select id={opening.id + '-swing'} className="floorplan-field" value={opening.swingDirection === 'out' ? 'out' : 'in'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { swingDirection: event.target.value })}>
                                <option value="in">Ke dalam</option>
                                <option value="out">Ke luar</option>
                              </select>
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-door-type'}>Jenis pintu</label>
                              <select id={opening.id + '-door-type'} className="floorplan-field" value={opening.doorType === 'double' ? 'double' : 'single'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { doorType: event.target.value })}>
                                <option value="single">Single</option>
                                <option value="double">Double</option>
                              </select>
                            </div>
                            <div className="floorplan-dimension-input">
                              <label htmlFor={opening.id + '-hinge-side'}>Engsel di sisi</label>
                              <select id={opening.id + '-hinge-side'} className="floorplan-field" value={opening.hingeSide === 'right' ? 'right' : 'left'} disabled={Boolean(selectedEntity.locked)} onChange={event => updateOpening(opening.id, { hingeSide: event.target.value })}>
                                <option value="left">Kiri</option>
                                <option value="right">Kanan</option>
                              </select>
                            </div>
                          </>}
                          <div className="floorplan-dimension-input">
                            <label htmlFor={opening.id + '-offset'}>Posisi (%)</label>
                            <input id={opening.id + '-offset'} className="floorplan-field" type="number" min="5" max="95" step="1" value={Math.round((Number(opening.offset) || 0.5) * 100)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                              const percent = Number(event.target.value)
                              if (!Number.isFinite(percent) || percent < 5 || percent > 95) return
                              updateOpening(opening.id, { offset: percent / 100 })
                            }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </section>
                </>
              )}

              {selectedType === 'prop' && (
                <>
                  <section className="floorplan-inspector-section">
                    <label htmlFor="prop-label">Nama properti</label>
                    <input id="prop-label" className="floorplan-field" value={selectedEntity.label || ''} maxLength={80} onChange={event => updateSelected({ label: event.target.value })} />
                  </section>
                  <section className="floorplan-inspector-section">
                    <div className="floorplan-section-title">Dimensi (meter)</div>
                    <div className="floorplan-opening-actions">
                      <div className="floorplan-dimension-input">
                        <label htmlFor="prop-width">Panjang (m)</label>
                        <input id="prop-width" className="floorplan-field" type="number" min="0.10" max="5.00" step="0.01" value={(Number(selectedEntity.width || 52) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                          const meters = Number(event.target.value)
                          if (!Number.isFinite(meters) || meters < 0.1 || meters > 5) return
                          updateSelected({ width: Math.round(meters * 100) })
                        }} />
                      </div>
                      <div className="floorplan-dimension-input">
                        <label htmlFor="prop-height">Lebar (m)</label>
                        <input id="prop-height" className="floorplan-field" type="number" min="0.10" max="5.00" step="0.01" value={(Number(selectedEntity.height || 36) / 100).toFixed(2)} disabled={Boolean(selectedEntity.locked)} onChange={event => {
                          const meters = Number(event.target.value)
                          if (!Number.isFinite(meters) || meters < 0.1 || meters > 5) return
                          updateSelected({ height: Math.round(meters * 100) })
                        }} />
                      </div>
                    </div>
                  </section>
                </>
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
                  <button key={object.entityType + object.id} className={'floorplan-object-row' + (selectedItems.some(entry => entry.type === object.entityType && entry.id === object.id) ? ' is-selected' : '')} onClick={() => { applyEntitySelection([{ type: object.entityType, id: object.id }], { type: object.entityType, id: object.id }); onSelectedShotIdChange?.(object.entityType === 'camera' ? (object.shotId || '') : '') }}>
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
      {roomMergePrompt && (
        <div className="floorplan-dialog-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) setRoomMergePrompt(null) }}>
          <section className="floorplan-dialog" role="dialog" aria-modal="true" aria-labelledby="room-merge-title" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <h3 id="room-merge-title">Gabungkan kedua Room?</h3>
            <p>Dua Room akan ditandai sebagai area yang tersambung. Bentuk dan nama masing-masing Room, semua dinding, pintu, dan jendela tetap dipertahankan.</p>
            {roomMergePrompt.error && <p role="alert">{roomMergePrompt.error}</p>}
            <div className="floorplan-dialog-actions">
              <button type="button" onClick={() => setRoomMergePrompt(null)}>Batal</button>
              <button type="button" onClick={confirmRoomMerge}>Sambungkan Room</button>
            </div>
          </section>
        </div>
      )}
      {roomVertexPrompt && (
        <div className="floorplan-dialog-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) setRoomVertexPrompt(null) }}>
          <section className="floorplan-dialog" role="dialog" aria-modal="true" aria-labelledby="room-vertex-title">
            <h3 id="room-vertex-title">Titik Room</h3>
            <p>Mau membuat Room baru yang dimulai dari titik ini?</p>
            <div className="floorplan-dialog-actions">
              <button type="button" onClick={() => setRoomVertexPrompt(null)}>Batal</button>
              <button type="button" onClick={beginRoomFromVertex}>Buat Room baru</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
