const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const pointsOf = room => Array.isArray(room?.points) ? room.points : []
const edgesOf = room => pointsOf(room).map((a, index, points) => ({ a, b: points[(index + 1) % points.length] })).filter(edge => edge.b)
const length = edge => distance(edge.a, edge.b)
const midpoint = edge => ({ x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 })
const unit = edge => { const n = length(edge) || 1; return { x: (edge.b.x - edge.a.x) / n, y: (edge.b.y - edge.a.y) / n } }
const samePoint = (a, b, tolerance = 1) => distance(a, b) <= tolerance

export function findRoomMergeCandidate(movingRoom, rooms, tolerance = 18) {
  let best = null
  for (const other of rooms) {
    if (!other || other.id === movingRoom?.id || other.locked || movingRoom?.locked) continue
    for (const a of edgesOf(movingRoom)) for (const b of edgesOf(other)) {
      const av = unit(a), bv = unit(b)
      if (Math.abs(av.x * bv.y - av.y * bv.x) > 0.035) continue
      const direct = Math.max(distance(a.a, b.a), distance(a.b, b.b))
      const reverse = Math.max(distance(a.a, b.b), distance(a.b, b.a))
      const endpointDistance = Math.min(direct, reverse)
      const lengthDelta = Math.abs(length(a) - length(b))
      const mid = midpoint(a), otherMid = midpoint(b)
      const lineDistance = Math.abs((mid.x - otherMid.x) * bv.y - (mid.y - otherMid.y) * bv.x)
      if (endpointDistance > tolerance || lengthDelta > tolerance * 1.5 || lineDistance > tolerance) continue
      const score = endpointDistance + lengthDelta * 0.5 + lineDistance
      if (!best || score < best.score) best = { movingRoomId: movingRoom.id, targetRoomId: other.id, movingEdge: a, targetEdge: b, reverse: reverse < direct, score }
    }
  }
  return best
}

export function mergeAdjacentRoomPolygons(movingRoom, targetRoom, candidate) {
  if (!movingRoom || !targetRoom || !candidate) return null
  const movingPoints = pointsOf(movingRoom).map(p => ({ ...p }))
  const targetPoints = pointsOf(targetRoom).map(p => ({ ...p }))
  const ma = candidate.movingEdge.a, mb = candidate.movingEdge.b
  const ta = candidate.targetEdge.a, tb = candidate.targetEdge.b
  const shift = candidate.reverse
    ? { x: (ma.x + mb.x - ta.x - tb.x) / 2, y: (ma.y + mb.y - ta.y - tb.y) / 2 }
    : { x: (ma.x + mb.x - tb.x - ta.x) / 2, y: (ma.y + mb.y - tb.y - ta.y) / 2 }
  const aligned = targetPoints.map(p => ({ x: Math.round(p.x + shift.x), y: Math.round(p.y + shift.y) }))
  const alignedA = { x: ta.x + shift.x, y: ta.y + shift.y }
  const alignedB = { x: tb.x + shift.x, y: tb.y + shift.y }
  const mi = movingPoints.findIndex((p, i) => samePoint(p, ma) && samePoint(movingPoints[(i + 1) % movingPoints.length], mb))
  const ti = aligned.findIndex((p, i) => samePoint(p, alignedA) && samePoint(aligned[(i + 1) % aligned.length], alignedB))
  if (mi < 0 || ti < 0) return null
  const m0 = movingPoints[mi], m1 = movingPoints[(mi + 1) % movingPoints.length]
  const t0 = aligned[ti], t1 = aligned[(ti + 1) % aligned.length]
  const same = samePoint(m0, t0) && samePoint(m1, t1)
  const reverse = samePoint(m0, t1) && samePoint(m1, t0)
  if (!same && !reverse) return null
  const edges = []
  const collect = (points, sharedStart, sharedEnd) => points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]
    if (samePoint(a, sharedStart) && samePoint(b, sharedEnd)) return
    edges.push({ a: { ...a }, b: { ...b } })
  })
  collect(movingPoints, m0, m1)
  collect(aligned, t0, t1)
  if (edges.length < 3) return null
  const polygon = []
  let edge = edges.shift()
  polygon.push(edge.a)
  let end = edge.b
  let guard = 0
  while (edges.length && guard++ < 1000) {
    polygon.push(end)
    const index = edges.findIndex(e => samePoint(e.a, end, 1.5))
    if (index < 0) return null
    edge = edges.splice(index, 1)[0]
    end = edge.b
  }
  if (edges.length || !samePoint(end, polygon[0], 1.5) || polygon.length < 3) return null
  const area = Math.abs(polygon.reduce((sum, p, i) => { const n = polygon[(i + 1) % polygon.length]; return sum + p.x * n.y - n.x * p.y }, 0)) / 2
  if (area < 16) return null
  const mergedPoints = polygon.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }))
  const hasSharedEdgeOpening = (room, edgeIndex) => (room.openings || []).some(opening => Number(opening.edgeIndex) === edgeIndex)
  if (hasSharedEdgeOpening(movingRoom, mi) || hasSharedEdgeOpening(targetRoom, ti)) return null

  const remapOpenings = (room, originalPoints) => (room.openings || []).map(opening => {
    const oldIndex = Number(opening.edgeIndex)
    if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= originalPoints.length) return { ...opening }
    const a = originalPoints[oldIndex]
    const b = originalPoints[(oldIndex + 1) % originalPoints.length]
    const edgeLength = distance(a, b)
    if (!edgeLength) return { ...opening }
    const offset = Math.max(0, Math.min(1, Number(opening.offset ?? 0.5)))
    const center = { x: a.x + (b.x - a.x) * offset, y: a.y + (b.y - a.y) * offset }
    let nearest = null
    edgesOf({ points: mergedPoints }).forEach((edge, edgeIndex) => {
      const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y
      const squared = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((center.x - edge.a.x) * dx + (center.y - edge.a.y) * dy) / squared))
      const projected = { x: edge.a.x + t * dx, y: edge.a.y + t * dy }
      const d = distance(center, projected)
      if (!nearest || d < nearest.distance) nearest = { edgeIndex, offset: t, distance: d }
    })
    if (!nearest || nearest.distance > 3) return { ...opening, edgeIndex: -1, needsReposition: true }
    return { ...opening, edgeIndex: nearest.edgeIndex, offset: nearest.offset }
  })
  const targetOpenings = remapOpenings(targetRoom, aligned)
  const movingOpenings = remapOpenings(movingRoom, movingPoints)
  if ([...targetOpenings, ...movingOpenings].some(opening => opening.needsReposition)) return null
  return { ...targetRoom, points: mergedPoints, openings: [...targetOpenings, ...movingOpenings] }
}
