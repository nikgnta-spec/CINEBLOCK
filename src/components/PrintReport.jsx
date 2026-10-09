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

function roomOpeningPlacement(room, opening) {
  const side = opening.side || 'bottom'
  const offset = Math.max(0.02, Math.min(0.98, Number(opening.offset) || 0.5))
  if (side === 'top') return { x: room.x + offset * room.width, y: room.y, angle: 180, length: room.width }
  if (side === 'right') return { x: room.x + room.width, y: room.y + offset * room.height, angle: -90, length: room.height }
  if (side === 'left') return { x: room.x, y: room.y + offset * room.height, angle: 90, length: room.height }
  return { x: room.x + offset * room.width, y: room.y + room.height, angle: 0, length: room.width }
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

  return (
    <section className="print-plan-page">
      <div className="print-section-kicker">FLOORPLAN</div>
      <h2>{scene.name || 'Scene'} — Top-Down Plan</h2>
      <div className="print-scene-meta">
        <span>{scene.intExt || 'INT'}</span>
        <span>{display(scene.location)}</span>
        <span>{scene.dayNight || 'DAY'}</span>
      </div>
      <svg className="print-plan-svg" viewBox="0 0 1000 650" role="img" aria-label={'Floorplan for ' + (scene.name || 'scene')}>
        <rect width="1000" height="650" fill="#fff" />
        {Array.from({ length: 41 }, (_, i) => (
          <line key={'gx' + i} x1={i * 25} y1="0" x2={i * 25} y2="650" stroke={i % 4 === 0 ? '#d1d5db' : '#edf0f2'} strokeWidth={i % 4 === 0 ? 1.1 : 0.6} />
        ))}
        {Array.from({ length: 27 }, (_, i) => (
          <line key={'gy' + i} x1="0" y1={i * 25} x2="1000" y2={i * 25} stroke={i % 4 === 0 ? '#d1d5db' : '#edf0f2'} strokeWidth={i % 4 === 0 ? 1.1 : 0.6} />
        ))}

        {rooms.map(room => (
          <rect key={'room-fill-' + room.id} x={room.x} y={room.y} width={room.width} height={room.height} fill="#fafafa" stroke="none" />
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
          const edges = [
            { side: 'top', x: room.x, y: room.y, length: room.width, horizontal: true },
            { side: 'right', x: room.x + room.width, y: room.y, length: room.height, horizontal: false },
            { side: 'bottom', x: room.x, y: room.y + room.height, length: room.width, horizontal: true },
            { side: 'left', x: room.x, y: room.y, length: room.height, horizontal: false },
          ]
          return (
            <g key={'room-outline-' + room.id}>
              {edges.flatMap(edge => openingSegments(edge.length, openings.filter(opening => (opening.side || 'bottom') === edge.side)).map((segment, index) => (
                <line
                  key={edge.side + index}
                  x1={edge.horizontal ? room.x + segment.start : edge.x}
                  y1={edge.horizontal ? edge.y : room.y + segment.start}
                  x2={edge.horizontal ? room.x + segment.end : edge.x}
                  y2={edge.horizontal ? edge.y : room.y + segment.end}
                  stroke="#111827"
                  strokeWidth="3"
                />
              )))}
              <text x={room.x + 9} y={room.y + 20} fontSize="16" fontWeight="700" fill="#111827">{room.label || 'Room'}</text>
              <text x={room.x + 9} y={room.y + 37} fontSize="12" fill="#374151">{meters(room.width)} × {meters(room.height)}</text>
              {openings.map(opening => {
                const p = roomOpeningPlacement(room, opening)
                const width = Math.min(Number(opening.width) || 48, p.length)
                return (
                  <g key={'room-opening-' + opening.id} transform={'translate(' + p.x + ' ' + p.y + ') rotate(' + p.angle + ')'} fill="none" stroke="#111827" strokeWidth="2">
                    {opening.type === 'door' ? (
                      <>
                        <path d={'M ' + (-width / 2) + ' 0 V ' + (-width)} />
                        <path d={'M ' + (-width / 2) + ' ' + (-width) + ' A ' + width + ' ' + width + ' 0 0 1 ' + (width / 2) + ' 0'} strokeDasharray="4 3" />
                      </>
                    ) : (
                      <>
                        <path d={'M ' + (-width / 2) + ' -4 H ' + (width / 2) + ' M ' + (-width / 2) + ' 0 H ' + (width / 2) + ' M ' + (-width / 2) + ' 4 H ' + (width / 2)} />
                        <path d={'M ' + (-width / 2) + ' -7 V 7 M ' + (width / 2) + ' -7 V 7'} />
                      </>
                    )}
                  </g>
                )
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
              <text x={(wall.x1 + wall.x2) / 2} y={(wall.y1 + wall.y2) / 2 - 9} fontSize="12" fill="#374151" textAnchor="middle">WALL · {meters(metric.length)} × {meters(wall.thickness || 6)}</text>
              {openings.map(opening => {
                const width = Math.min(Number(opening.width) || 48, metric.length)
                const center = Math.max(0, Math.min(1, Number(opening.offset) || 0.5)) * metric.length
                return (
                  <g key={'wall-opening-' + opening.id} transform={'translate(' + (wall.x1 + metric.ux * center) + ' ' + (wall.y1 + metric.uy * center) + ') rotate(' + metric.angle + ')'} fill="none" stroke="#111827" strokeWidth="2">
                    {opening.type === 'door' ? (
                      <>
                        <path d={'M ' + (-width / 2) + ' 0 V ' + (-width)} />
                        <path d={'M ' + (-width / 2) + ' ' + (-width) + ' A ' + width + ' ' + width + ' 0 0 1 ' + (width / 2) + ' 0'} strokeDasharray="4 3" />
                      </>
                    ) : (
                      <>
                        <path d={'M ' + (-width / 2) + ' -4 H ' + (width / 2) + ' M ' + (-width / 2) + ' 0 H ' + (width / 2) + ' M ' + (-width / 2) + ' 4 H ' + (width / 2)} />
                        <path d={'M ' + (-width / 2) + ' -7 V 7 M ' + (width / 2) + ' -7 V 7'} />
                      </>
                    )}
                  </g>
                )
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
    src,
    label: project.visualRefLabels?.[index] || 'Reference ' + (index + 1),
  })).filter(reference => typeof reference.src === 'string' && reference.src.length > 0)

  return (
    <main className={'print-report print-mode-' + mode + ' print-orientation-' + orientation}>
      {mode !== 'floorplan' && (
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
                <figure key={reference.label + reference.src.slice(0, 32)}>
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

      {mode !== 'floorplan' && (
      <section className="print-shot-list-section">
        <div className="print-section-kicker">SHOT LIST</div>
        <h2>Scenes & Camera Coverage</h2>
        {scenes.map((scene, index) => (
          <section className="print-scene-shots" key={scene.id}>
            <div className="print-scene-heading">
              <div>
                <h3>{String(index + 1).padStart(2, '0')} · {scene.name || 'Scene'}</h3>
                <p>{scene.intExt || 'INT'} · {display(scene.location)} · {scene.dayNight || 'DAY'}</p>
              </div>
              <span>{(scene.shots || []).length} shot{(scene.shots || []).length === 1 ? '' : 's'}</span>
            </div>
            {(scene.shots || []).length === 0 ? (
              <p className="print-muted">No shots added.</p>
            ) : (
              (scene.shots || []).map((shot, shotIndex) => (
                <article className="print-shot-card" key={shot.id || shotIndex}>
                  <div className="print-shot-heading">
                    <strong>#{shot.num || String(shotIndex + 1).padStart(3, '0')}</strong>
                    <span>{display(shot.subject)}</span>
                  </div>
                  <div className="print-shot-fields">
                    <div><span>Size</span><strong>{display(shot.size)}</strong></div>
                    <div><span>Camera</span><strong>{display(shot.camera)}</strong></div>
                    <div><span>Angle</span><strong>{display(shot.angle)}</strong></div>
                    <div><span>Status</span><strong>{shot.status === 'done' ? 'Done' : shot.status === 'skip' ? 'Skip' : 'Planned'}</strong></div>
                    <div><span>Lens</span><strong>{display(shot.lens)}</strong></div>
                    <div><span>Movement</span><strong>{display(shot.movements)}</strong></div>
                    <div><span>Equipment</span><strong>{display(shot.equipment)}</strong></div>
                    <div><span>Sound</span><strong>{display(shot.sound)}</strong></div>
                    <div><span>Take</span><strong>{display(shot.take)}</strong></div>
                    <div><span>Script</span><strong>{display(shot.script)}</strong></div>
                    <div><span>Setup</span><strong>{display(shot.setup)}</strong></div>
                    <div><span>Est. Shoot</span><strong>{display(shot.estShoot)}</strong></div>
                  </div>
                  {shot.storyboardImage && (
                    <figure className="print-storyboard">
                      <img src={shot.storyboardImage} alt={'Storyboard shot ' + (shot.num || shotIndex + 1)} />
                      <figcaption>Storyboard · {shot.num || String(shotIndex + 1).padStart(3, '0')}</figcaption>
                    </figure>
                  )}
                  {shot.notes && <p className="print-shot-notes"><strong>Notes:</strong> {shot.notes}</p>}
                </article>
              ))
            )}
          </section>
        ))}
      </section>
      )}

      {mode !== 'shotlist' && scenes.map(scene => (
        <PrintFloorplan key={'plan-' + scene.id} scene={scene} layout={floorplans?.[scene.id] || {}} />
      ))}

      <footer className="print-report-footer">CINEBLOCK · Production Planning Report</footer>
    </main>
  )
}
