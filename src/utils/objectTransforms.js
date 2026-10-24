export function rotateObjectGroup(items, degrees) {
  const angle = Number(degrees)
  const eligible = (Array.isArray(items) ? items : []).filter(item => (
    item && !item.locked
    && Number.isFinite(Number(item.x))
    && Number.isFinite(Number(item.y))
  ))
  if (!Number.isFinite(angle) || eligible.length < 2) return eligible

  const minX = Math.min(...eligible.map(item => Number(item.x)))
  const maxX = Math.max(...eligible.map(item => Number(item.x)))
  const minY = Math.min(...eligible.map(item => Number(item.y)))
  const maxY = Math.max(...eligible.map(item => Number(item.y)))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const radians = angle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)

  return eligible.map(item => {
    const dx = Number(item.x) - centerX
    const dy = Number(item.y) - centerY
    const nextAngle = ((Number(item.angle) || 0) + angle) % 360
    return {
      ...item,
      x: Math.round(centerX + dx * cosine - dy * sine),
      y: Math.round(centerY + dx * sine + dy * cosine),
      angle: (nextAngle + 360) % 360,
    }
  })
}
