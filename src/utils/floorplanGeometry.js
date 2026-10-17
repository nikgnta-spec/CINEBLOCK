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

  return { rooms: nextRooms, walls: normalizeWallJunctions([...nextWalls, wall], makeId) }
}


const sameJunction = (a, b, tolerance = 1.5) =>
  Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.y) - Number(b?.y)) <= tolerance

/**
 * Keep Room vertices and Wall endpoints attached when either side of a
 * junction is edited. This deliberately changes only coordinates: opening
 * offsets and all unrelated geometry remain stable.
 */
export function synchronizeJunctionMoves(rooms = [], walls = [], moves = [], tolerance = 1.5) {
  if (!moves.length) return { rooms, walls }
  const movePoint = point => {
    const move = moves.find(candidate => sameJunction(point, candidate.from, tolerance))
    return move ? { x: Math.round(move.to.x), y: Math.round(move.to.y) } : point
  }
  const nextRooms = rooms.map(room => {
    const source = Array.isArray(room.points) && room.points.length >= 3
      ? room.points
      : [
          { x: room.x, y: room.y },
          { x: room.x + room.width, y: room.y },
          { x: room.x + room.width, y: room.y + room.height },
          { x: room.x, y: room.y + room.height },
        ]
    let changed = false
    const points = source.map(point => {
      const next = movePoint(point)
      if (next !== point) changed = true
      return next
    })
    if (!changed) return room
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    return { ...room, points, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  })
  const nextWalls = walls.map(wall => {
    const start = movePoint({ x: wall.x1, y: wall.y1 })
    const end = movePoint({ x: wall.x2, y: wall.y2 })
    if (start.x === wall.x1 && start.y === wall.y1 && end.x === wall.x2 && end.y === wall.y2) return wall
    return { ...wall, x1: start.x, y1: start.y, x2: end.x, y2: end.y }
  })
  return { rooms: nextRooms, walls: nextWalls }
}

/**
 * Move a Room's editable polygon points and propagate every changed junction
 * to connected Walls. Existing wall endpoints are authoritative connections;
 * no near-but-unconnected geometry is moved.
 */
export function updateRoomPolygonGeometry(rooms = [], walls = [], roomId, nextPoints) {
  const room = rooms.find(item => item.id === roomId)
  if (!room || !Array.isArray(nextPoints) || nextPoints.length !== room.points?.length) return { rooms, walls }
  const previousPoints = room.points
  const moves = previousPoints.flatMap((from, index) => {
    const to = nextPoints[index]
    return to && !sameJunction(from, to, 0.01) ? [{ from, to }] : []
  })
  const synchronized = synchronizeJunctionMoves(rooms, walls, moves)
  const nextRooms = synchronized.rooms.map(item => item.id === roomId
    ? { ...item, points: nextPoints.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })) }
    : item)
  return { rooms: nextRooms, walls: synchronized.walls }
}

/**
 * Move a Wall endpoint and all Room vertices / other Wall endpoints attached
 * to its old coordinate, keeping a single shared junction rather than a gap.
 */
export function updateWallEndpointGeometry(rooms = [], walls = [], wallId, endpoint, point) {
  const wall = walls.find(item => item.id === wallId)
  if (!wall || !['start', 'end'].includes(endpoint)) return { rooms, walls }
  const from = endpoint === 'start' ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 }
  const to = { x: Math.round(point.x), y: Math.round(point.y) }
  const synchronized = synchronizeJunctionMoves(rooms, walls, [{ from, to }])
  return { rooms: synchronized.rooms, walls: synchronized.walls }
}


/**
 * Split collinear overlaps at every shared endpoint and collapse duplicate
 * atomic segments. This keeps the drawn line continuous without rendering
 * stacked duplicate Walls, while preserving IDs and remapping opening offsets.
 */
export function normalizeWallJunctions(walls = [], makeId = () => `wall-${Math.random().toString(36).slice(2)}`) {
  const tolerance = ROOM_JUNCTION_TOLERANCE
  const split = walls.flatMap(wall => {
    const source = { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 }
    const length = Math.hypot(source.x2 - source.x1, source.y2 - source.y1)
    if (length < 0.01) return []
    const cuts = [0, 1]
    for (const other of walls) {
      if (other.id === wall.id) continue
      for (const endpoint of [{ x: other.x1, y: other.y1 }, { x: other.x2, y: other.y2 }]) {
        const projection = projectPointToSegment(endpoint, source)
        if (projection.distance < tolerance && projection.t > 0.001 && projection.t < 0.999) cuts.push(projection.t)
      }
    }
    cuts.sort((a, b) => a - b)
    const unique = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]) > 0.001)
    return unique.slice(0, -1).map((startT, index) => {
      const endT = unique[index + 1]
      const xAt = t => Math.round(source.x1 + (source.x2 - source.x1) * t)
      const yAt = t => Math.round(source.y1 + (source.y2 - source.y1) * t)
      const segment = {
        ...wall,
        ...(index === 0 ? {} : { id: makeId() }),
        x1: xAt(startT), y1: yAt(startT), x2: xAt(endT), y2: yAt(endT),
        openings: [],
      }
      for (const opening of wall.openings || []) {
        const offset = Math.max(0, Math.min(1, Number(opening.offset ?? 0.5)))
        if ((offset <= startT + 0.001 && startT > 0.001) || offset > endT + 0.001) continue
        segment.openings.push({ ...opening, offset: endT > startT ? Math.max(0, Math.min(1, (offset - startT) / (endT - startT))) : 0.5 })
      }
      return segment
    })
  })
  const unique = []
  for (const segment of split) {
    const duplicate = unique.find(existing =>
      (sameJunction({ x: existing.x1, y: existing.y1 }, { x: segment.x1, y: segment.y1 }, tolerance) &&
       sameJunction({ x: existing.x2, y: existing.y2 }, { x: segment.x2, y: segment.y2 }, tolerance)) ||
      (sameJunction({ x: existing.x1, y: existing.y1 }, { x: segment.x2, y: segment.y2 }, tolerance) &&
       sameJunction({ x: existing.x2, y: existing.y2 }, { x: segment.x1, y: segment.y1 }, tolerance))
    )
    if (!duplicate) {
      unique.push(segment)
      continue
    }
    const seen = new Set((duplicate.openings || []).map(opening => opening.id).filter(Boolean))
    duplicate.openings = [...(duplicate.openings || []), ...(segment.openings || []).filter(opening => !opening.id || !seen.has(opening.id))]
  }
  return unique
}
