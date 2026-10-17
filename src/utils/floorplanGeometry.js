import { projectPointToSegment } from './roomSnapping.js'

const ROOM_JUNCTION_TOLERANCE = 1.5

/**
 * Canonical polygon geometry used by both Room creation and Wall connections.
 * A Room is represented by the same ordered vertices that describe its
 * perimeter wall segments.
 */
export function createRoomPolygon(start, end, id, label) {
  const x1 = Math.round(Math.min(start.x, end.x))
  const y1 = Math.round(Math.min(start.y, end.y))
  const x2 = Math.round(Math.max(start.x, end.x))
  const y2 = Math.round(Math.max(start.y, end.y))
  if (x2 - x1 < 12 || y2 - y1 < 12) return null
  return {
    id,
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    points: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
    label,
  }
}

/**
 * Insert a junction into every Room perimeter and split every intersected
 * Wall segment at the same point. This is the shared geometry operation for
 * connecting wall-mode drawing to room-mode geometry.
 */
export function connectWallGeometry(rooms = [], walls = [], wall, makeId) {
  const endpoints = [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]
  const nextRooms = rooms.map(room => {
    const source = Array.isArray(room.points) && room.points.length >= 3
      ? room.points
      : [
          { x: room.x, y: room.y },
          { x: room.x + room.width, y: room.y },
          { x: room.x + room.width, y: room.y + room.height },
          { x: room.x, y: room.y + room.height },
        ]
    let points = source.map(point => ({ ...point }))
    let changed = false

    for (const endpoint of endpoints) {
      if (points.some(point => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < ROOM_JUNCTION_TOLERANCE)) continue
      const edgeIndex = points.findIndex((start, index) => {
        const end = points[(index + 1) % points.length]
        const projection = projectPointToSegment(endpoint, { x1: start.x, y1: start.y, x2: end.x, y2: end.y })
        return projection.distance < ROOM_JUNCTION_TOLERANCE && projection.t > 0.01 && projection.t < 0.99
      })
      if (edgeIndex < 0) continue
      const start = points[edgeIndex]
      const end = points[(edgeIndex + 1) % points.length]
      const projection = projectPointToSegment(endpoint, { x1: start.x, y1: start.y, x2: end.x, y2: end.y })
      points.splice(edgeIndex + 1, 0, { x: Math.round(projection.point.x), y: Math.round(projection.point.y) })
      changed = true
    }
    return changed ? { ...room, points } : room
  })

  const nextWalls = walls.flatMap(existingWall => {
    let segments = [{ ...existingWall, openings: [...(existingWall.openings || [])] }]
    for (const endpoint of endpoints) {
      segments = segments.flatMap(segment => {
        const projection = projectPointToSegment(endpoint, segment)
        if (projection.distance >= ROOM_JUNCTION_TOLERANCE || projection.t <= 0.01 || projection.t >= 0.99) return [segment]

        const junction = { x: Math.round(projection.point.x), y: Math.round(projection.point.y) }
        const start = { x: segment.x1, y: segment.y1 }
        const end = { x: segment.x2, y: segment.y2 }
        const splitAt = projection.t
        const first = { ...segment, x2: junction.x, y2: junction.y, openings: [] }
        const second = { ...segment, id: makeId(), x1: junction.x, y1: junction.y, openings: [] }

        for (const opening of segment.openings || []) {
          const openingOffset = Math.max(0, Math.min(1, Number(opening.offset ?? 0.5)))
          const openingCenter = {
            x: start.x + (end.x - start.x) * openingOffset,
            y: start.y + (end.y - start.y) * openingOffset,
          }
          const openingProjection = projectPointToSegment(openingCenter, segment)
          if (openingProjection.t <= splitAt) {
            first.openings.push({ ...opening, offset: splitAt > 0 ? openingProjection.t / splitAt : 0 })
          } else {
            second.openings.push({ ...opening, offset: (openingProjection.t - splitAt) / (1 - splitAt) })
          }
        }
        return [first, second]
      })
    }
    return segments
  })

  return { rooms: nextRooms, walls: [...nextWalls, wall] }
}
