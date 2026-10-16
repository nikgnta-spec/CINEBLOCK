const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const pointsOf = room => Array.isArray(room?.points) ? room.points : []
const edgesOf = room => pointsOf(room).map((a, index, points) => ({ a, b: points[(index + 1) % points.length], index })).filter(edge => edge.b)
const length = edge => distance(edge.a, edge.b)
const unit = edge => { const n = length(edge) || 1; return { x: (edge.b.x - edge.a.x) / n, y: (edge.b.y - edge.a.y) / n } }
const samePoint = (a, b, tolerance = 1) => distance(a, b) <= tolerance
const dot = (a, b) => a.x * b.x + a.y * b.y
const cross = (a, b) => a.x * b.y - a.y * b.x
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const addScaled = (a, v, t) => ({ x: a.x + v.x * t, y: a.y + v.y * t })

function overlapOnLine(a, b, tolerance) {
  const av = unit(a), bv = unit(b)
  if (Math.abs(cross(av, bv)) > 0.035) return null
  const lineDistance = Math.abs(cross(subtract(b.a, a.a), av))
  if (lineDistance > tolerance) return null
  const aLength = length(a), bLength = length(b)
  if (aLength < 1 || bLength < 1) return null
  const bStart = dot(subtract(b.a, a.a), av)
  const bEnd = dot(subtract(b.b, a.a), av)
  const low = Math.max(0, Math.min(bStart, bEnd))
  const high = Math.min(aLength, Math.max(bStart, bEnd))
  if (high - low <= 1) return null
  // Different edge lengths are valid: only require a real shared segment.
  return { low, high, overlap: high - low, gap: 0, lineDistance, av, bv }
}

export function findRoomMergeCandidate(movingRoom, rooms, tolerance = 18) {
  let best = null
  for (const other of rooms) {
    if (!other || other.id === movingRoom?.id || other.locked || movingRoom?.locked) continue
    for (const a of edgesOf(movingRoom)) for (const b of edgesOf(other)) {
      const overlap = overlapOnLine(a, b, tolerance)
      if (!overlap || overlap.gap > tolerance) continue
      const score = overlap.lineDistance + overlap.gap + Math.abs(overlap.overlap - Math.min(length(a), length(b))) * 0.001
      if (!best || score < best.score) best = {
        movingRoomId: movingRoom.id, targetRoomId: other.id,
        movingEdge: a, targetEdge: b, reverse: dot(overlap.av, overlap.bv) < 0,
        overlapStart: overlap.low, overlapEnd: overlap.high, score
      }
    }
  }
  return best
}

function projectPoint(point, edge) {
  const v = subtract(edge.b, edge.a)
  const squared = dot(v, v) || 1
  const t = dot(subtract(point, edge.a), v) / squared
  return { t, point: addScaled(edge.a, v, t) }
}

function splitAndCancelEdges(roomPoints, otherPoints, tolerance = 1.5) {
  const all = [
    ...edgesOf({ points: roomPoints }).map(edge => ({ ...edge, source: 0 })),
    ...edgesOf({ points: otherPoints }).map(edge => ({ ...edge, source: 1 }))
  ]
  const pieces = []
  for (const edge of all) {
    const v = subtract(edge.b, edge.a)
    const len = length(edge)
    if (len < 0.01) continue
    const cuts = [0, 1]
    for (const other of all) {
      if (edge === other) continue
      const ov = subtract(other.b, other.a)
      if (Math.abs(cross(v, ov)) / (len * (length(other) || 1)) > 0.035) continue
      if (Math.abs(cross(subtract(other.a, edge.a), v)) / len > tolerance) continue
      for (const p of [other.a, other.b]) {
        const t = dot(subtract(p, edge.a), v) / (len * len)
        if (t > 0.0001 && t < 0.9999 && distance(p, addScaled(edge.a, v, t)) <= tolerance) cuts.push(t)
      }
    }
    cuts.sort((a, b) => a - b)
    const unique = cuts.filter((t, i) => i === 0 || Math.abs(t - cuts[i - 1]) > 0.0001)
    for (let i = 0; i < unique.length - 1; i++) {
      const t0 = unique[i], t1 = unique[i + 1]
      const a = addScaled(edge.a, v, t0), b = addScaled(edge.a, v, t1)
      if (distance(a, b) > 0.01) pieces.push({ a, b, source: edge.source })
    }
  }
  const removed = new Set()
  for (let i = 0; i < pieces.length; i++) {
    if (removed.has(i)) continue
    for (let j = i + 1; j < pieces.length; j++) {
      if (removed.has(j) || pieces[i].source === pieces[j].source) continue
      const a = pieces[i], b = pieces[j]
      if (samePoint(a.a, b.b, tolerance) && samePoint(a.b, b.a, tolerance)) {
        removed.add(i); removed.add(j); break
      }
    }
  }
  return pieces.filter((_, i) => !removed.has(i))
}

function tracePolygon(edges) {
  if (edges.length < 3) return null
  // Trace only edge-to-edge connections. Do not silently bridge a missing
  // segment with a diagonal: that creates self-crossing/notched Rooms when
  // the shared wall is only partially overlapping.
  const remaining = [...edges]
  const first = remaining.shift()
  const polygon = [{ ...first.a }]
  let current = first.b
  let previousDirection = subtract(first.b, first.a)
  let guard = 0

  while (guard++ < edges.length + 2) {
    if (samePoint(current, polygon[0], 1.5)) break
    const candidates = []
    for (let i = 0; i < remaining.length; i++) {
      const edge = remaining[i]
      if (samePoint(edge.a, current, 1.5)) candidates.push({ i, edge, reverse: false })
      if (samePoint(edge.b, current, 1.5)) candidates.push({ i, edge, reverse: true })
    }
    if (!candidates.length) return null
    // At a T-junction, choose the continuation that follows the exterior
    // boundary with the smallest turn rather than whichever edge appears first.
    candidates.sort((left, right) => {
      const direction = item => {
        const a = item.reverse ? item.edge.b : item.edge.a
        const b = item.reverse ? item.edge.a : item.edge.b
        return subtract(b, a)
      }
      const turn = v => Math.atan2(cross(previousDirection, v), dot(previousDirection, v))
      return turn(direction(left)) - turn(direction(right))
    })
    const chosen = candidates[0]
    remaining.splice(chosen.i, 1)
    const next = chosen.reverse ? chosen.edge.a : chosen.edge.b
    if (!samePoint(current, polygon[polygon.length - 1], 1.5)) polygon.push({ ...current })
    previousDirection = subtract(next, current)
    current = next
  }

  if (remaining.length || !samePoint(current, polygon[0], 1.5) || polygon.length < 3) return null
  const cleaned = polygon.filter((p, i) => i === 0 || !samePoint(p, polygon[i - 1], 1))
  if (cleaned.length < 3) return null
  const area = cleaned.reduce((sum, p, i) => { const n = cleaned[(i + 1) % cleaned.length]; return sum + p.x * n.y - n.x * p.y }, 0) / 2
  if (Math.abs(area) < 16) return null
  return cleaned.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }))
}

export function mergeAdjacentRoomPolygons(movingRoom, targetRoom, candidate) {
  if (!movingRoom || !targetRoom || !candidate) return null
  const movingPoints = pointsOf(movingRoom).map(p => ({ ...p }))
  const targetPoints = pointsOf(targetRoom).map(p => ({ ...p }))
  const mi = candidate.movingEdge?.index
  const ti = candidate.targetEdge?.index
  if (!Number.isInteger(mi) || !Number.isInteger(ti)) return null
  const movingEdge = edgesOf({ points: movingPoints })[mi]
  const targetEdge = edgesOf({ points: targetPoints })[ti]
  if (!movingEdge || !targetEdge) return null

  const overlap = overlapOnLine(movingEdge, targetEdge, 18)
  if (!overlap) return null
  // Move the target polygon only perpendicular to the shared edge, closing a small gap
  // without forcing the two rooms' edge lengths to match.
  const normal = { x: -overlap.av.y, y: overlap.av.x }
  const signed = dot(subtract(targetEdge.a, movingEdge.a), normal)
  const shift = { x: -normal.x * signed, y: -normal.y * signed }
  const alignedTarget = targetPoints.map(p => ({ x: p.x + shift.x, y: p.y + shift.y }))

  // Openings on the shared segment become internal and are intentionally
  // removed during the merge. Openings outside that segment are preserved.
  const sharedRange = overlapOnLine(movingEdge, { a: { x: targetEdge.a.x + shift.x, y: targetEdge.a.y + shift.y }, b: { x: targetEdge.b.x + shift.x, y: targetEdge.b.y + shift.y } }, 1.5)
  if (!sharedRange) return null
  const isOpeningOnSharedSegment = (opening, roomPoints, edgeIndex) => {
    if (Number(opening.edgeIndex) !== edgeIndex) return false
    const edge = edgesOf({ points: roomPoints })[edgeIndex]
    if (!edge) return false
    const offset = Math.max(0, Math.min(1, Number(opening.offset ?? 0.5)))
    const center = addScaled(edge.a, subtract(edge.b, edge.a), offset)
    const coordinate = dot(subtract(center, movingEdge.a), overlap.av)
    return coordinate >= sharedRange.low - 1 && coordinate <= sharedRange.high + 1
  }

  const rawEdges = splitAndCancelEdges(movingPoints, alignedTarget)
  const mergedPoints = tracePolygon(rawEdges)
  if (!mergedPoints) return null

  const remapOpenings = (room, originalPoints, sharedEdgeIndex, shiftBy = { x: 0, y: 0 }) => (room.openings || []).filter(opening => !isOpeningOnSharedSegment(opening, originalPoints, sharedEdgeIndex)).map(opening => {
    const oldIndex = Number(opening.edgeIndex)
    if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= originalPoints.length) return { ...opening }
    const originalEdge = edgesOf({ points: originalPoints })[oldIndex]
    if (!originalEdge) return { ...opening }
    const offset = Math.max(0, Math.min(1, Number(opening.offset ?? 0.5)))
    const center = addScaled(originalEdge.a, subtract(originalEdge.b, originalEdge.a), offset)
    center.x += shiftBy.x; center.y += shiftBy.y
    let nearest = null
    for (const edge of edgesOf({ points: mergedPoints })) {
      const projection = projectPoint(center, edge)
      const d = distance(center, projection.point)
      if (projection.t >= -0.001 && projection.t <= 1.001 && (!nearest || d < nearest.distance)) nearest = { edgeIndex: edge.index, offset: Math.max(0, Math.min(1, projection.t)), distance: d }
    }
    if (!nearest || nearest.distance > 3) return { ...opening, edgeIndex: -1, needsReposition: true }
    return { ...opening, edgeIndex: nearest.edgeIndex, offset: nearest.offset }
  })
  const targetOpenings = remapOpenings(targetRoom, targetPoints, ti, shift)
  const movingOpenings = remapOpenings(movingRoom, movingPoints, mi)
  if ([...targetOpenings, ...movingOpenings].some(opening => opening.needsReposition)) return null
  return { ...targetRoom, points: mergedPoints, openings: [...targetOpenings, ...movingOpenings] }
}


/**
 * Rigidly snap a Room edge onto a target Room edge. The moving Room is rotated
 * around the midpoint of the selected edge, then translated only along the
 * target edge's normal. All edge lengths and opening offsets remain unchanged.
 * Returns the transformed polygon points, or null for invalid geometry.
 */
export function snapRoomToEdge(room, movingEdge, targetEdge) {
  const points = pointsOf(room).map(point => ({ x: Number(point.x), y: Number(point.y) }))
  if (points.length < 3 || !movingEdge?.a || !movingEdge?.b || !targetEdge?.a || !targetEdge?.b) return null
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
  const movingLength = distance(movingEdge.a, movingEdge.b)
  const targetLength = distance(targetEdge.a, targetEdge.b)
  if (movingLength < 1 || targetLength < 1) return null

  const movingAngle = Math.atan2(movingEdge.b.y - movingEdge.a.y, movingEdge.b.x - movingEdge.a.x)
  const targetAngle = Math.atan2(targetEdge.b.y - targetEdge.a.y, targetEdge.b.x - targetEdge.a.x)
  const rotation = Math.atan2(Math.sin(targetAngle - movingAngle), Math.cos(targetAngle - movingAngle))
  // Merge candidates are deliberately limited to nearly parallel edges. Reject
  // unexpected input rather than silently rotating a Room by a large amount.
  if (Math.abs(rotation) > 0.08) return null

  const pivot = { x: (movingEdge.a.x + movingEdge.b.x) / 2, y: (movingEdge.a.y + movingEdge.b.y) / 2 }
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  const rotated = points.map(point => {
    const x = point.x - pivot.x, y = point.y - pivot.y
    return { x: pivot.x + x * cos - y * sin, y: pivot.y + x * sin + y * cos }
  })
  const targetUnit = unit(targetEdge)
  const normal = { x: -targetUnit.y, y: targetUnit.x }
  const signedDistance = (pivot.x - targetEdge.a.x) * normal.x + (pivot.y - targetEdge.a.y) * normal.y
  const shift = { x: -normal.x * signedDistance, y: -normal.y * signedDistance }
  return rotated.map(point => ({ x: point.x + shift.x, y: point.y + shift.y }))
}
