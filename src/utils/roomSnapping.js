/**
 * Snap a point independently along X and Y to nearby alignment coordinates.
 * Each axis can select a different anchor, allowing the cursor to land at the
 * intersection of a vertical guide from one vertex and a horizontal guide
 * from another vertex.
 */
export function snapRoomPoint(point, origin, anchors, tolerance) {
  if (!origin) return { point, guides: [] }

  const candidates = [origin, ...anchors].filter(anchor =>
    Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)
  )

  const nearestOnAxis = (coordinate, axis) => {
    let nearest = null
    let distance = tolerance
    for (const anchor of candidates) {
      const nextDistance = Math.abs(coordinate - anchor[axis])
      if (nextDistance <= distance) {
        distance = nextDistance
        nearest = anchor
      }
    }
    return nearest
  }

  // These searches intentionally run separately; neither result affects the
  // candidate list or tolerance used by the other axis.
  const xAnchor = nearestOnAxis(point.x, 'x')
  const yAnchor = nearestOnAxis(point.y, 'y')
  const snappedX = xAnchor ? xAnchor.x : point.x
  const snappedY = yAnchor ? yAnchor.y : point.y
  const guides = []

  if (xAnchor) guides.push({ axis: 'vertical', x: snappedX, y: xAnchor.y })
  if (yAnchor) guides.push({ axis: 'horizontal', x: yAnchor.x, y: snappedY })

  return { point: { x: snappedX, y: snappedY }, guides }
}


/**
 * Project a point onto a finite segment. Used by wall drawing so new walls can
 * attach to the middle of an existing Room edge or Wall, not only its corners.
 */
export function projectPointToSegment(point, segment) {
  const dx = segment.x2 - segment.x1
  const dy = segment.y2 - segment.y1
  const lengthSquared = dx * dx + dy * dy
  if (!Number.isFinite(lengthSquared) || lengthSquared < 1e-8) {
    const projected = { x: segment.x1, y: segment.y1 }
    return { point: projected, t: 0, distance: Math.hypot(point.x - projected.x, point.y - projected.y) }
  }
  const t = Math.max(0, Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared))
  const projected = { x: segment.x1 + dx * t, y: segment.y1 + dy * t }
  return { point: projected, t, distance: Math.hypot(point.x - projected.x, point.y - projected.y) }
}
