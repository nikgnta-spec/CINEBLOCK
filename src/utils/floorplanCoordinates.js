const MAX_WORLD_COORDINATE = 1_000_000

// Keep coordinates in the floorplan's world space. The visible canvas is only
// an initial viewport and must not be used as a persistence boundary.
export function normalizeFloorplanCoordinate(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.max(-MAX_WORLD_COORDINATE, Math.min(MAX_WORLD_COORDINATE, number))
    : 0
}

export function normalizeFloorplanAngle(value) {
  const number = Number(value)
  return Number.isFinite(number) ? ((number % 360) + 360) % 360 : 0
}
