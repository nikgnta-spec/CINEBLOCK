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
