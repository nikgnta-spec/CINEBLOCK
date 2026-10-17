const display = value => {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'string') return value.trim() || '—'
  return value === null || value === undefined ? '—' : String(value)
}

const meters = value => (Math.max(0, Number(value) || 0) / 100).toFixed(2) + ' m'

function openingSegments(length, openings = []) {
  const ranges = openings
    .map(opening => {
      const width = Math.min(Number(opening.width) || 48, length)
      const center = Math.max(0, Math.min(1, Number(opening.offset) || 0.5)) * length
      return { start: Math.max(0, center - width / 2), end: Math.min(length, center + width / 2) }
    })
    .sort((a, b) => a.start - b.start)
  const result = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) result.push({ start: cursor, end: range.start })
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < length) result.push({ start: cursor, end: length })
  return result
}

function wallMetrics(wall) {
  const dx = (Number(wall.x2) || 0) - (Number(wall.x1) || 0)
  const dy = (Number(wall.y2) || 0) - (Number(wall.y1) || 0)
  const length = Math.hypot(dx, dy)
  return { dx, dy, length, ux: dx / (length || 1), uy: dy / (length || 1), angle: Math.atan2(dy, dx) * 180 / Math.PI }
}

function roomPoints(room) {
  if (Array.isArray(room.points) && room.points.length >= 3) return room.points
  return [{ x: room.x, y: room.y }, { x: room.x + room.width, y: room.y }, { x: room.x + room.width, y: room.y + room.height }, { x: room.x, y: room.y + room.height }]
}

function roomInternalWalls(room) {
  const stored = Array.isArray(room?.internalWalls) ? room.internalWalls.filter(wall =>
    [wall.x1, wall.y1, wall.x2, wall.y2].every(value => Number.isFinite(Number(value)))
      && Math.hypot(Number(wall.x2) - Number(wall.x1), Number(wall.y2) - Number(wall.y1)) > 1
  ) : []
  if (stored.length) return stored
  const points = roomPoints(room)
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
      if (!pointInPolygon({ x: (point.x + corner.x) / 2, y: (point.y + corner.y) / 2 }, points)) return null
      return { index, point, length: Math.hypot(dx, dy) }
    }).filter(Boolean).sort((a, b) => a.length - b.length)
    const candidate = candidates[0]
    if (!candidate) continue
    walls.push({ x1: corner.x, y1: corner.y, x2: candidate.point.x, y2: candidate.point.y, legacyInferred: true })
    used.add(candidate.index)
  }
  return walls
}

function roomEdges(room) {
  return roomPoints(room).map((point, index, points) => {
    const next = points[(index + 1) % points.length]
    const dx = next.x - point.x, dy = next.y - point.y
    return { edgeIndex: index, x1: point.x, y1: point.y, x2: next.x, y2: next.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI }
  })
}

function pointInPolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x)
    if (intersects) inside = !inside
  }
  return inside
}

function roomOpeningPlacement(room, opening) {
  const offset = Math.max(0.02, Math.min(0.98, Number(opening.offset) || 0.5))
  if (opening.wallType === 'internal' && Number.isInteger(opening.internalWallIndex)) {
    const wall = roomInternalWalls(room)[opening.internalWallIndex]
    if (wall) {
      const metrics = wallMetrics(wall)
      return { x: wall.x1 + metrics.ux * metrics.length * offset, y: wall.y1 + metrics.uy * metrics.length * offset, angle: metrics.angle + 180, length: metrics.length }
    }
  }
  const edges = roomEdges(room)
  const edge = edges[Math.max(0, Math.min(edges.length - 1, Number.isInteger(opening.edgeIndex) ? opening.edgeIndex : ({ top: 0, right: 1, bottom: 2, left: 3 }[opening.side] ?? 2)))] || edges[0]
  return { x: edge.x1 + (edge.x2 - edge.x1) * offset, y: edge.y1 + (edge.y2 - edge.y1) * offset, angle: edge.angle + 180, length: edge.length }
}

function focalLength(value) {
  if (typeof value !== 'string') return null
  const range = value.match(/(\d+(?:\.\d+)?)\s*(?:mm)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*mm?/i)
  if (range) return Math.min(Number(range[1]), Number(range[2]))
  const single = value.match(/(\d+(?:\.\d+)?)\s*mm?/i)
  return single && Number(single[1]) > 0 ? Number(single[1]) : null
}

function fovPath(lens) {
  const focal = focalLength(lens)
  if (!focal) return null
  const radius = 190
  const half = Math.atan(36 / (2 * focal))
  const x1 = radius * Math.cos(-half)
  const y1 = radius * Math.sin(-half)
  const x2 = radius * Math.cos(half)
  const y2 = radius * Math.sin(half)
  return `M 12 0 L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`
}

function lightPath() {
  const radius = 220
  const half = 28 * Math.PI / 180
  const x1 = radius * Math.cos(-half)
  const y1 = radius * Math.sin(-half)
  const x2 = radius * Math.cos(half)
  const y2 = radius * Math.sin(half)
  return `M 14 0 L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`
}

function PrintFloorplan({ scene, layout }) {
  const plan = layout || {}
  const rooms = plan.rooms || []
  const walls = plan.walls || []
  const props = plan.props || []
  const actors = plan.actors || []
  const cameras = plan.cameras || []
  const lights = plan.lights || []
  const shots = scene.shots || []
  const planPoints = [
    ...rooms.flatMap(room => roomPoints(room)),
    ...walls.flatMap(wall => [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]),
    ...props.map(item => ({ x: item.x, y: item.y })),
    ...actors.map(item => ({ x: item.x, y: item.y })),
    ...cameras.map(item => ({ x: item.x, y: item.y })),
    ...lights.map(item => ({ x: item.x, y: item.y })),
  ]
  const planBounds = planPoints.length ? {
    minX: Math.min(...planPoints.map(point => point.x)),
    maxX: Math.max(...planPoints.map(point => point.x)),
    minY: Math.min(...planPoints.map(point => point.y)),
    maxY: Math.max(...planPoints.map(point => point.y)),
  } : null
  // Reserve drawing space for dimension guides and labels outside the room polygon.
  // Fit the complete measured plan into the PDF frame instead of centering only the walls.
  const planScale = planBounds ? Math.min(
    900 / (planBounds.maxX - planBounds.minX + 360 || 1),
    570 / (planBounds.maxY - planBounds.minY + 360 || 1),
  ) : 1
  const planTranslate = planBounds ? {
    x: 500 - ((planBounds.minX + planBounds.maxX) / 2) * planScale,
    y: 325 - ((planBounds.minY + planBounds.maxY) / 2) * planScale,
  } : { x: 0, y: 0 }

  return (
    <section className="print-plan-page">
      <div className="print-section-kicker">FLOORPLAN</div>
      <h2>{scene.name || 'Scene'}</h2>
      <div className="print-scene-meta">
        <span>{scene.intExt || 'INT'}</span>
        <span>{display(scene.location)}</span>
        <span>{scene.dayNight || 'DAY'}</span>
      </div>
      <svg className="print-plan-svg" viewBox="0 0 1000 650" role="img" aria-label={'Floorplan for ' + (scene.name || 'scene')}>
        <rect width="1000" height="650" fill="#fff" />
        {/* Export only the plan and its measurements, not the editor workspace grid. */}

        <g transform={'translate(' + planTranslate.x + ' ' + planTranslate.y + ') scale(' + planScale + ')'}>
        {rooms.map(room => (
          <polygon key={'room-fill-' + room.id} points={roomPoints(room).map(point => point.x + ',' + point.y).join(' ')} fill="#fafafa" stroke="none" />
        ))}

        {lights.map(light => (
          <path
            key={'light-cone-' + light.id}
            d={lightPath()}
            transform={'translate(' + light.x + ' ' + light.y + ') rotate(' + (90 + (light.angle || 0)) + ')'}
            fill="#cbd5e1"
            fillOpacity="0.38"
            stroke="#64748b"
            strokeOpacity="0.65"
            strokeWidth="1.4"
          />
        ))}

        {cameras.map(camera => {
          const shot = shots.find(item => item.id === camera.shotId)
          const fov = fovPath(shot?.lens || '')
          return fov ? (
            <path key={'camera-fov-' + camera.id} d={fov} transform={'translate(' + camera.x + ' ' + camera.y + ') rotate(' + (camera.angle || 0) + ')'} fill="#bfdbfe" fillOpacity="0.25" stroke="#64748b" strokeWidth="1.2" />
          ) : null
        })}

        {rooms.map(room => {
          const openings = room.openings || []
          const points = roomPoints(room)
          const edges = roomEdges(room)
          const bounds = {
            x: Math.min(...points.map(point => point.x)),
            y: Math.min(...points.map(point => point.y)),
            maxX: Math.max(...points.map(point => point.x)),
            maxY: Math.max(...points.map(point => point.y)),
          }
          // Mirror the editor's connected-room group measurements in the PDF.
          const roomById = new Map(rooms.map(item => [item.id, item]))
          const visitedRoomIds = new Set([room.id])
          const roomQueue = [room.id]
          while (roomQueue.length) {
            const current = roomById.get(roomQueue.shift())
            ;(current?.connectedRoomIds || []).forEach(id => {
              if (roomById.has(id) && !visitedRoomIds.has(id)) {
                visitedRoomIds.add(id)
                roomQueue.push(id)
              }
            })
          }
          const connectedRoomGroup = [...visitedRoomIds].map(id => roomById.get(id)).filter(Boolean)
          const connectedPoints = connectedRoomGroup.flatMap(roomPoints)
          const connectedBounds = connectedPoints.length ? {
            x: Math.min(...connectedPoints.map(point => point.x)),
            y: Math.min(...connectedPoints.map(point => point.y)),
            maxX: Math.max(...connectedPoints.map(point => point.x)),
            maxY: Math.max(...connectedPoints.map(point => point.y)),
          } : bounds
          const isConnectedGroupOwner = connectedRoomGroup.length > 1
            && room.id === connectedRoomGroup.map(item => item.id).sort()[0]
          return (
            <g key={'room-outline-' + room.id}>
              {edges.flatMap(edge => openingSegments(edge.length, openings.filter(opening => opening.wallType !== 'internal' && !Number.isInteger(opening.internalWallIndex) && (Number.isInteger(opening.edgeIndex) ? opening.edgeIndex : ({ top: 0, right: 1, bottom: 2, left: 3 }[opening.side] ?? 2)) === edge.edgeIndex)).map((segment, index) => {
                const ux = (edge.x2 - edge.x1) / (edge.length || 1)
                const uy = (edge.y2 - edge.y1) / (edge.length || 1)
                return <line key={edge.edgeIndex + '-' + index} x1={edge.x1 + ux * segment.start} y1={edge.y1 + uy * segment.start} x2={edge.x1 + ux * segment.end} y2={edge.y1 + uy * segment.end} stroke="#111827" strokeWidth="3" />
              }))}
              {roomInternalWalls(room).map((wall, wallIndex) => {
                const metric = wallMetrics(wall)
                const wallOpenings = openings.filter(opening => opening.wallType === 'internal' && opening.internalWallIndex === wallIndex)
                return openingSegments(metric.length, wallOpenings).map((segment, segmentIndex) => (
                  <line key={'internal-wall-' + wallIndex + '-' + segmentIndex}
                    x1={wall.x1 + metric.ux * segment.start} y1={wall.y1 + metric.uy * segment.start}
                    x2={wall.x1 + metric.ux * segment.end} y2={wall.y1 + metric.uy * segment.end}
                    stroke="#111827" strokeWidth="3" />
                ))
              })}
              <text x={bounds.x + 9} y={bounds.y + 18} fontSize="13" fontWeight="700" fill="#111827">{room.label || 'Room'}</text>
              <text x={bounds.x + 9} y={bounds.y + 36} fontSize="12" fill="#374151">{meters(bounds.maxX - bounds.x) + ' × ' + meters(bounds.maxY - bounds.y)}</text>
              {Number.isFinite(Number(room.ceilingHeight)) && Number(room.ceilingHeight) > 0 && <text x={bounds.x + 9} y={bounds.y + 52} fontSize="12" fill="#374151">{Number(room.ceilingHeight).toFixed(1) + ' m ceiling'}</text>}
              {edges.filter(edge => {
                // A shared wall between connected Rooms is internal to the group;
                // dimension it once as geometry, not once for each Room.
                return !connectedRoomGroup.some(other => other.id !== room.id
                  && roomEdges(other).some(otherEdge => {
                    const samePoint = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1
                    return (samePoint({ x: edge.x1, y: edge.y1 }, { x: otherEdge.x1, y: otherEdge.y1 })
                      && samePoint({ x: edge.x2, y: edge.y2 }, { x: otherEdge.x2, y: otherEdge.y2 }))
                      || (samePoint({ x: edge.x1, y: edge.y1 }, { x: otherEdge.x2, y: otherEdge.y2 })
                      && samePoint({ x: edge.x2, y: edge.y2 }, { x: otherEdge.x1, y: otherEdge.y1 }))
                  }))
              }).map(edge => {
                const horizontal = Math.abs(edge.x2 - edge.x1) >= Math.abs(edge.y2 - edge.y1)
                const mx = (edge.x1 + edge.x2) / 2
                const my = (edge.y1 + edge.y2) / 2
                const dx = edge.x2 - edge.x1
                const dy = edge.y2 - edge.y1
                const length = edge.length || 1
                let nx = dy / length
                let ny = -dx / length
                const probeDistance = Math.max(2, Math.min(8, length * 0.04))
                const positiveProbe = { x: mx + nx * probeDistance, y: my + ny * probeDistance }
                const negativeProbe = { x: mx - nx * probeDistance, y: my - ny * probeDistance }
                const positiveInside = pointInPolygon(positiveProbe, points)
                const negativeInside = pointInPolygon(negativeProbe, points)
                if (positiveInside && !negativeInside) { nx *= -1; ny *= -1 }
                // Place dimension guides outside the actual polygon, including concave rooms.
                const offset = 72
                const x1 = horizontal ? Math.min(edge.x1, edge.x2) : mx + nx * offset
                const x2 = horizontal ? Math.max(edge.x1, edge.x2) : mx + nx * offset
                const y1 = horizontal ? my + ny * offset : Math.min(edge.y1, edge.y2)
                const y2 = horizontal ? my + ny * offset : Math.max(edge.y1, edge.y2)
                const label = meters(edge.length)
                return <g key={'room-dimension-' + edge.edgeIndex} fill="none" stroke="#64748b" strokeWidth="1.2">
                  <line x1={x1} y1={y1} x2={x2} y2={y2} />
                  {horizontal ? <>
                    <line x1={x1} y1={y1 - 5} x2={x1} y2={y1 + 5} />
                    <line x1={x2} y1={y2 - 5} x2={x2} y2={y2 + 5} />
                  </> : <>
                    <line x1={x1 - 5} y1={y1} x2={x1 + 5} y2={y1} />
                    <line x1={x2 - 5} y1={y2} x2={x2 + 5} y2={y2} />
                  </>}
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7} fill="#374151" stroke="#fff" strokeWidth="4" paintOrder="stroke" fontSize="12" textAnchor="middle">{label}</text>

                </g>
              })}
              {connectedRoomGroup.length === 1 && (() => {
                // A standalone Room gets its own bounding-box dimensions.
                // Connected groups show their bounding-box dimensions once below.
                const totalLength = bounds.maxX - bounds.x
                const totalWidth = bounds.maxY - bounds.y
                const horizontalY = bounds.y - 112
                const verticalX = bounds.maxX + 112
                return <g fill="none" stroke="#64748b" strokeWidth="1.2">
                  <line x1={bounds.x} y1={horizontalY} x2={bounds.maxX} y2={horizontalY} />
                  <line x1={bounds.x} y1={horizontalY - 5} x2={bounds.x} y2={horizontalY + 5} />
                  <line x1={bounds.maxX} y1={horizontalY - 5} x2={bounds.maxX} y2={horizontalY + 5} />
                  <text x={(bounds.x + bounds.maxX) / 2} y={horizontalY - 8} fill="#374151" stroke="#fff" strokeWidth="4" paintOrder="stroke" fontSize="12" textAnchor="middle">{meters(totalLength)} total</text>
                  <line x1={verticalX} y1={bounds.y} x2={verticalX} y2={bounds.maxY} />
                  <line x1={verticalX - 5} y1={bounds.y} x2={verticalX + 5} y2={bounds.y} />
                  <line x1={verticalX - 5} y1={bounds.maxY} x2={verticalX + 5} y2={bounds.maxY} />
                  <text x={verticalX + 14} y={(bounds.y + bounds.maxY) / 2} fill="#374151" stroke="#fff" strokeWidth="4" paintOrder="stroke" fontSize="12" textAnchor="middle" transform={'rotate(90 ' + (verticalX + 14) + ' ' + ((bounds.y + bounds.maxY) / 2) + ')'}>{meters(totalWidth)} total</text>
                </g>
              })()}
              {isConnectedGroupOwner && (() => {
                const totalLength = connectedBounds.maxX - connectedBounds.x
                const totalWidth = connectedBounds.maxY - connectedBounds.y
                const horizontalY = connectedBounds.y - 160
                const verticalX = connectedBounds.maxX + 160
                return <g fill="none" stroke="#475569" strokeWidth="1.4">
                  <line x1={connectedBounds.x} y1={horizontalY} x2={connectedBounds.maxX} y2={horizontalY} />
                  <line x1={connectedBounds.x} y1={horizontalY - 5} x2={connectedBounds.x} y2={horizontalY + 5} />
                  <line x1={connectedBounds.maxX} y1={horizontalY - 5} x2={connectedBounds.maxX} y2={horizontalY + 5} />
                  <text x={(connectedBounds.x + connectedBounds.maxX) / 2} y={horizontalY - 8} fill="#1d4ed8" stroke="#fff" strokeWidth="4" paintOrder="stroke" fontSize="13" fontWeight="700" textAnchor="middle">{meters(totalLength)} total gabungan</text>
                  <line x1={verticalX} y1={connectedBounds.y} x2={verticalX} y2={connectedBounds.maxY} />
                  <line x1={verticalX - 5} y1={connectedBounds.y} x2={verticalX + 5} y2={connectedBounds.y} />
                  <line x1={verticalX - 5} y1={connectedBounds.maxY} x2={verticalX + 5} y2={connectedBounds.maxY} />
                  <text x={verticalX + 14} y={(connectedBounds.y + connectedBounds.maxY) / 2} fill="#1d4ed8" stroke="#fff" strokeWidth="4" paintOrder="stroke" fontSize="13" fontWeight="700" textAnchor="middle" transform={'rotate(90 ' + (verticalX + 14) + ' ' + ((connectedBounds.y + connectedBounds.maxY) / 2) + ')'}>{meters(totalWidth)} total gabungan</text>
                </g>
              })()}
              {openings.map(opening => {
                const p = roomOpeningPlacement(room, opening)
                const width = Math.min(Number(opening.width) || 48, p.length)
                return (
                  <g key={'room-opening-' + opening.id} transform={'translate(' + p.x + ' ' + p.y + ') rotate(' + p.angle + ')'} fill="none" stroke="#111827" strokeWidth="2">
                    {opening.type === 'door' ? (
                      opening.doorType === 'double' ? (() => {
                        const direction = opening.swingDirection === 'out' ? -1 : 1
                        const leaf = width / 2
                        return <>
                          <path d={'M ' + (-width / 2) + ' 0 H ' + (width / 2)} />
                          <path d={'M ' + (-width / 2) + ' 0 L ' + (-width / 2) + ' ' + (direction * leaf) + ' M ' + (width / 2) + ' 0 L ' + (width / 2) + ' ' + (direction * leaf)} strokeWidth="3" />
                          <path d={'M ' + (-width / 2) + ' ' + (direction * leaf) + ' A ' + leaf + ' ' + leaf + ' 0 0 ' + (direction < 0 ? 1 : 0) + ' 0 0 M ' + (width / 2) + ' ' + (direction * leaf) + ' A ' + leaf + ' ' + leaf + ' 0 0 ' + (direction > 0 ? 1 : 0) + ' 0 0'} strokeDasharray="4 3" />
                        </>
                      })() : (() => {
                        const direction = opening.swingDirection === 'out' ? -1 : 1
                        const hingeX = opening.hingeSide === 'right' ? width / 2 : -width / 2
                        const freeX = -hingeX
                        return <>
                          <path d={'M ' + (-width / 2) + ' 0 H ' + (width / 2)} />
                          <path d={'M ' + hingeX + ' 0 L ' + hingeX + ' ' + (direction * width)} strokeWidth="3" />
                          <path d={'M ' + hingeX + ' ' + (direction * width) + ' A ' + width + ' ' + width + ' 0 0 ' + ((opening.hingeSide === 'right') === (direction > 0) ? 1 : 0) + ' ' + freeX + ' 0'} strokeDasharray="4 3" />
                        </>
                      })()
                    ) : opening.type === 'doorway' ? null : (
                      <>
                        <path d={'M ' + (-width / 2) + ' -4 H ' + (width / 2) + ' M ' + (-width / 2) + ' 0 H ' + (width / 2) + ' M ' + (-width / 2) + ' 4 H ' + (width / 2)} />
                        <path d={'M ' + (-width / 2) + ' -7 V 7 M ' + (width / 2) + ' -7 V 7'} />
                      </>
                    )}
                  </g>
                )
              })}
              {openings.filter(opening => !(opening.wallType === 'internal' && Number.isInteger(opening.internalWallIndex))).map(opening => {
                // A door on a merged Room's former shared wall stays visible (see internal-wall
                // rendering above), but the Floorplan canvas never captions it with dimensions —
                // doing so here made that internal doorway read as its own separate, titled Room.
                const p = roomOpeningPlacement(room, opening)
                const width = Math.min(Number(opening.width) || 48, p.length)
                return <g key={'room-opening-dimension-' + opening.id}>
                  <text x={p.x} y={p.y + 24} fontSize="11" fontWeight="600" fill="#374151" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{opening.type === 'doorway' ? (opening.label || 'Pintu Tanpa Daun') : opening.type === 'door' ? 'Pintu' : 'Jendela'} {meters(width)} × {meters(Number(opening.height ?? (opening.type === 'door' ? 210 : 120)))}</text>
                  {opening.type === 'door' && <text x={p.x} y={p.y + 38} fontSize="10" fontWeight="600" fill="#92400e" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{'Daun pintu ' + meters(width) + ' m'}</text>}
                </g>
              })}
            </g>
          )
        })}

        {walls.map(wall => {
          const metric = wallMetrics(wall)
          const openings = wall.openings || []
          return (
            <g key={'wall-' + wall.id}>
              {openingSegments(metric.length, openings).map((segment, index) => (
                <line
                  key={index}
                  x1={wall.x1 + metric.ux * segment.start}
                  y1={wall.y1 + metric.uy * segment.start}
                  x2={wall.x1 + metric.ux * segment.end}
                  y2={wall.y1 + metric.uy * segment.end}
                  stroke="#111827"
                  strokeWidth={wall.thickness || 6}
                  strokeLinecap="square"
                />
              ))}
              {openings.map(opening => {
                const width = Math.min(Number(opening.width) || 48, metric.length)
                const center = Math.max(0, Math.min(1, Number(opening.offset) || 0.5)) * metric.length
                return (
                  <g key={'wall-opening-' + opening.id} transform={'translate(' + (wall.x1 + metric.ux * center) + ' ' + (wall.y1 + metric.uy * center) + ') rotate(' + metric.angle + ')'} fill="none" stroke="#111827" strokeWidth="2">
                    {opening.type === 'door' ? (
                      opening.doorType === 'double' ? (() => {
                        const direction = opening.swingDirection === 'out' ? -1 : 1
                        const leaf = width / 2
                        return <>
                          <path d={'M ' + (-width / 2) + ' 0 H ' + (width / 2)} />
                          <path d={'M ' + (-width / 2) + ' 0 L ' + (-width / 2) + ' ' + (direction * leaf) + ' M ' + (width / 2) + ' 0 L ' + (width / 2) + ' ' + (direction * leaf)} strokeWidth="3" />
                          <path d={'M ' + (-width / 2) + ' ' + (direction * leaf) + ' A ' + leaf + ' ' + leaf + ' 0 0 ' + (direction < 0 ? 1 : 0) + ' 0 0 M ' + (width / 2) + ' ' + (direction * leaf) + ' A ' + leaf + ' ' + leaf + ' 0 0 ' + (direction > 0 ? 1 : 0) + ' 0 0'} strokeDasharray="4 3" />
                        </>
                      })() : (() => {
                        const direction = opening.swingDirection === 'out' ? -1 : 1
                        const hingeX = opening.hingeSide === 'right' ? width / 2 : -width / 2
                        const freeX = -hingeX
                        return <>
                          <path d={'M ' + (-width / 2) + ' 0 H ' + (width / 2)} />
                          <path d={'M ' + hingeX + ' 0 L ' + hingeX + ' ' + (direction * width)} strokeWidth="3" />
                          <path d={'M ' + hingeX + ' ' + (direction * width) + ' A ' + width + ' ' + width + ' 0 0 ' + ((opening.hingeSide === 'right') === (direction > 0) ? 1 : 0) + ' ' + freeX + ' 0'} strokeDasharray="4 3" />
                        </>
                      })()
                    ) : opening.type === 'doorway' ? null : (
                      <>
                        <path d={'M ' + (-width / 2) + ' -4 H ' + (width / 2) + ' M ' + (-width / 2) + ' 0 H ' + (width / 2) + ' M ' + (-width / 2) + ' 4 H ' + (width / 2)} />
                        <path d={'M ' + (-width / 2) + ' -7 V 7 M ' + (width / 2) + ' -7 V 7'} />
                      </>
                    )}
                  </g>
                )
              })}
              {openings.map(opening => {
                const width = Math.min(Number(opening.width) || 48, metric.length)
                const center = Math.max(0, Math.min(1, Number(opening.offset) || 0.5)) * metric.length
                const x = wall.x1 + metric.ux * center
                const y = wall.y1 + metric.uy * center
                return <g key={'wall-opening-dimension-' + opening.id}>
                  <text x={x} y={y + 24} fontSize="11" fontWeight="600" fill="#374151" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{opening.type === 'doorway' ? (opening.label || 'Pintu Tanpa Daun') : opening.type === 'door' ? 'Pintu' : 'Jendela'} {meters(width)} × {meters(Number(opening.height ?? (opening.type === 'door' ? 210 : 120)))}</text>
                  {opening.type === 'door' && <text x={x} y={y + 38} fontSize="10" fontWeight="600" fill="#92400e" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{'Daun pintu ' + meters(width) + ' m'}</text>}
                </g>
              })}
            </g>
          )
        })}

        {props.map(prop => (
          <g key={'prop-' + prop.id} transform={'translate(' + prop.x + ' ' + prop.y + ') rotate(' + (prop.angle || 0) + ')'}>
            <rect x={-(Number(prop.width) || 52) / 2} y={-(Number(prop.height) || 36) / 2} width={Number(prop.width) || 52} height={Number(prop.height) || 36} rx={prop.propType === 'Sofa' ? 8 : 2} fill="#fff" stroke="#111827" strokeWidth="2" />
            <text x="0" y="4" fontSize="12" fontWeight="600" fill="#111827" textAnchor="middle">{prop.propType || 'Prop'}</text>
          </g>
        ))}

        {actors.map(actor => (
          <g key={'actor-' + actor.id} transform={'translate(' + actor.x + ' ' + actor.y + ') rotate(' + (actor.angle || 0) + ')'}>
            <circle r="13" fill="#fff" stroke="#111827" strokeWidth="2.5" />
            <path d="M-17 24 Q0 8 17 24" fill="none" stroke="#111827" strokeWidth="3" strokeLinecap="round" />
            <text x="0" y="42" fontSize="13" fontWeight="600" fill="#111827" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{actor.label || 'Actor'}</text>
            {(actor.path || []).length > 0 && <polyline points={[{ x: actor.x, y: actor.y }, ...actor.path].map(point => point.x + ',' + point.y).join(' ')} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray="7 5" />}
          </g>
        ))}

        {cameras.map(camera => {
          const shot = shots.find(item => item.id === camera.shotId)
          return (
            <g key={'camera-' + camera.id} transform={'translate(' + camera.x + ' ' + camera.y + ') rotate(' + (camera.angle || 0) + ')'}>
              <path d="M9 -9 L33 -20 L33 20 L9 9 Z" fill="#fff" stroke="#111827" strokeWidth="2.5" />
              <rect x="-29" y="-15" width="40" height="30" rx="6" fill="#fff" stroke="#111827" strokeWidth="2.5" />
              <text x="0" y="46" fontSize="14" fontWeight="700" fill="#111827" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{shot?.num || 'CAM'}</text>
              {(camera.path || []).length > 0 && <polyline points={[{ x: camera.x, y: camera.y }, ...camera.path].map(point => point.x + ',' + point.y).join(' ')} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray="7 5" />}
            </g>
          )
        })}

        {lights.map(light => (
          <g key={'light-' + light.id} transform={'translate(' + light.x + ' ' + light.y + ') rotate(' + (90 + (light.angle || 0)) + ')'}>
            <path d="M-13 -8 L-8 -11 L3 -11 L11 -7 L11 7 L3 11 L-8 11 L-13 8 Z" fill="#fff" stroke="#111827" strokeWidth="2.5" />
            <circle cx="7" cy="0" r="4" fill="#111827" />
            <text x="0" y="35" fontSize="13" fontWeight="600" fill="#111827" stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">{light.lightType || 'Key'}</text>
          </g>
        ))}
        </g>
      </svg>
      <div className="print-plan-legend">
        <span>Room / Wall</span><span>Door</span><span>Window</span><span>Prop</span><span>Actor</span><span>Camera + FOV</span><span>Lighting + cone</span>
      </div>
      {rooms.length + walls.length + props.length + actors.length + cameras.length + lights.length === 0 && (
        <p className="print-muted">No floorplan objects added for this scene.</p>
      )}
    </section>
  )
}

export default function PrintReport({ project, scenes, floorplans, mode = 'full', orientation = 'portrait' }) {
  const references = (project.visualRefs || []).map((src, index) => ({
    id: index,
    src,
    label: project.visualRefLabels?.[index] || 'Reference ' + (index + 1),
  })).filter(reference => typeof reference.src === 'string' && reference.src.length > 0)

  const includeCover = mode === 'full'
  const tableMode = mode === 'shotlist-table' || mode === 'full'
  const storyboardMode = mode === 'storyboard'
  const includeShotList = tableMode || storyboardMode
  const includeFloorplans = mode === 'floorplan' || mode === 'full'
  const storyboardItems = scenes.flatMap((scene, sceneIndex) => (
    (scene.shots || []).map((shot, shotIndex) => ({ scene, sceneIndex, shot, shotIndex }))
  ))

  return (
    <main className={'print-report print-mode-' + mode + ' print-orientation-' + orientation}>
      {includeCover && (
        <section className="print-cover">
          <div className="print-brand-row">
            <strong className="print-brand">CINEBLOCK</strong>
            <span>PRODUCTION PLANNING REPORT</span>
          </div>
          <p className="print-section-kicker">PROJECT INFORMATION</p>
          <h1>{display(project.title) === '—' ? 'Untitled Project' : project.title}</h1>
          <div className="print-project-meta">
            <div><span>Director</span><strong>{display(project.director)}</strong></div>
            <div><span>Director of Photography</span><strong>{display(project.dop)}</strong></div>
            <div><span>Production Company</span><strong>{display(project.production)}</strong></div>
            <div><span>Genre</span><strong>{display(project.genre)}</strong></div>
            <div><span>Duration</span><strong>{display(project.duration)}</strong></div>
            <div><span>Format</span><strong>{display(project.format)}</strong></div>
            <div><span>Aspect Ratio</span><strong>{display(project.aspectRatio)}</strong></div>
            <div><span>Camera</span><strong>{display(project.camera)}</strong></div>
            <div><span>Lens System</span><strong>{display(project.lensSystem)}</strong></div>
            <div><span>Scenes</span><strong>{scenes.length}</strong></div>
            <div><span>Total Shots</span><strong>{scenes.reduce((total, scene) => total + (scene.shots || []).length, 0)}</strong></div>
          </div>
          {project.visualApproach && (
            <div className="print-copy-block">
              <h2>General Visual Approach</h2>
              <p>{project.visualApproach}</p>
            </div>
          )}
          {project.lightingApproach && (
            <div className="print-copy-block">
              <h2>General Lighting Approach</h2>
              <p>{project.lightingApproach}</p>
            </div>
          )}
          {references.length > 0 && (
            <div className="print-references">
              <h2>Visual References</h2>
              <div className="print-reference-grid">
                {references.map(reference => (
                  <figure key={reference.id}>
                    <img src={reference.src} alt={reference.label} />
                    <figcaption>{reference.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
          <div className="print-cover-footer">Generated with CINEBLOCK</div>
        </section>
      )}

      {includeShotList && (
        <section className={'print-shot-list-section' + (tableMode ? ' print-table-section' : ' print-storyboard-section')}>
          <div className="print-section-kicker">{storyboardMode ? 'STORYBOARD' : 'SHOT LIST'}</div>
          <h2>{storyboardMode ? 'Storyboard & Camera Coverage' : 'Shot List'}</h2>

          {storyboardMode ? (
            <div className="print-storyboard-all-shots">
              {storyboardItems.length === 0 ? (
                <p className="print-muted">Belum ada shot di proyek ini.</p>
              ) : storyboardItems.map(({ scene, sceneIndex, shot, shotIndex }) => (
                <article className="print-storyboard-card" key={scene.id + '-' + (shot.id || shotIndex)}>
                  <div className="print-storyboard-scene-label">
                    <strong>{String(sceneIndex + 1).padStart(2, '0')} · {scene.name || 'Scene'}</strong>
                    <span>{scene.intExt || 'INT'} · {display(scene.location)} · {scene.dayNight || 'DAY'}</span>
                  </div>
                  <header className="print-storyboard-card-header">
                    <strong>#{shot.num || String(shotIndex + 1).padStart(3, '0')}</strong>
                    <span>{display(shot.subject)}</span>
                    <small className={'print-storyboard-status status-' + (['done', 'skip'].includes(shot.status) ? shot.status : 'planned')}>
                      {shot.status === 'done' ? 'Done' : shot.status === 'skip' ? 'Skip' : 'Planned'}
                    </small>
                  </header>
                  {shot.storyboardImage ? (
                    <figure className="print-storyboard-image">
                      <img src={shot.storyboardImage} alt={'Storyboard shot ' + (shot.num || shotIndex + 1)} />
                    </figure>
                  ) : (
                    <div className="print-storyboard-placeholder">Storyboard belum ditambahkan</div>
                  )}
                  <div className="print-storyboard-details">
                    <span><small>Size</small><strong>{display(shot.size)}</strong></span>
                    <span><small>Camera</small><strong>{display(shot.camera)}</strong></span>
                    <span><small>Angle</small><strong>{display(shot.angle)}</strong></span>
                    <span><small>Lens</small><strong>{display(shot.lens)}</strong></span>
                    <span><small>Movement</small><strong>{display(shot.movements)}</strong></span>
                    <span><small>Equipment</small><strong>{display(shot.equipment)}</strong></span>
                  </div>
                  {shot.notes && <p className="print-storyboard-notes">{shot.notes}</p>}
                </article>
              ))}
            </div>
          ) : (
            scenes.map((scene, index) => (
              <section className="print-scene-shots" key={scene.id}>
                <div className="print-scene-heading">
                  <div>
                    <h3>{String(index + 1).padStart(2, '0')} · {scene.name || 'Scene'}</h3>
                    <p>{scene.intExt || 'INT'} · {display(scene.location)} · {scene.dayNight || 'DAY'}</p>
                  </div>
                  <span>{(scene.shots || []).length} shot{(scene.shots || []).length === 1 ? '' : 's'}</span>
                </div>
                <table className="print-shot-table">
                  <colgroup>
                    <col className="col-shot" />
                    <col className="col-subject" />
                    <col className="col-size" />
                    <col className="col-camera" />
                    <col className="col-angle" />
                    <col className="col-lens" />
                    <col className="col-movement" />
                    <col className="col-equipment" />
                    <col className="col-sound" />
                    <col className="col-take" />
                    <col className="col-script" />
                    <col className="col-setup" />
                    <col className="col-time" />
                    <col className="col-notes" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Shot</th><th>Subjek</th><th>Size</th><th>Kamera</th><th>Angle</th><th>Lens</th>
                      <th>Movement</th><th>Equipment</th><th>Audio</th><th>Take</th><th>Script</th>
                      <th>Setup</th><th>Est. Shoot</th><th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scene.shots || []).length === 0 ? (
                      <tr><td colSpan={14} className="print-empty-row">Belum ada shot di scene ini.</td></tr>
                    ) : (scene.shots || []).map((shot, shotIndex) => (
                      <tr key={shot.id || shotIndex}>
                        <td className="print-table-shot-number">{shot.num || String(shotIndex + 1).padStart(3, '0')}</td>
                        <td className="print-table-subject">{display(shot.subject)}</td>
                        <td>{display(shot.size)}</td>
                        <td>{display(shot.camera)}</td>
                        <td>{display(shot.angle)}</td>
                        <td>{display(shot.lens)}</td>
                        <td>{display(shot.movements)}</td>
                        <td>{display(shot.equipment)}</td>
                        <td>{display(shot.sound)}</td>
                        <td>{display(shot.take)}</td>
                        <td>{display(shot.script)}</td>
                        <td>{display(shot.setup)}</td>
                        <td>{display(shot.estShoot)}</td>
                        <td>{display(shot.notes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </section>
      )}

      {includeFloorplans && scenes.map(scene => (
        <PrintFloorplan key={'plan-' + scene.id} scene={scene} layout={floorplans?.[scene.id] || {}} />
      ))}

      <footer className="print-report-footer">CINEBLOCK · Production Planning Report</footer>
    </main>
  )
}
