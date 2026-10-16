import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { snapRoomPoint } from '../src/utils/roomSnapping.js'

const readSource = path => readFile(new URL(path, import.meta.url), 'utf8')

test('App wires shared scene and floorplan state into both planning tabs', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /<ShotList[\s\S]*?scenes=\{scenes\}[\s\S]*?onChange=\{setScenes\}[\s\S]*?floorplans=\{floorplans\}[\s\S]*?onFloorplansChange=\{setFloorplans\}/)
  assert.match(source, /<Floorplan[\s\S]*?scenes=\{scenes\}[\s\S]*?onChange=\{setScenes\}[\s\S]*?floorplans=\{floorplans\}[\s\S]*?onFloorplansChange=\{setFloorplans\}/)
})

test('Floorplan resolves and edits linked shots by stable IDs, not row numbers', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /scene\?\.shots\.find\(shot => shot\.id === selectedEntity\.shotId\)/)
  assert.match(source, /const shotId = selectedEntity\.shotId/)
  assert.match(source, /currentScene\.shots\.map\(shot => shot\.id === shotId/)
  assert.match(source, /const validShotIds = new Set\(\(scene\.shots \|\| \[\]\)\.map\(shot => shot\.id\)\)/)
  assert.match(source, /shotId && !validShotIds\.has\(camera\.shotId\)/)
})

test('Shot List deletes the chosen shot by ID and warns when a camera is linked', async () => {
  const source = await readSource('../src/components/ShotList.jsx')

  assert.match(source, /shots: renumberShots\(s\.shots\.filter\(sh => sh\.id !== shotId\)\)/)
  assert.match(source, /hasLinkedCamera[\s\S]*?camera\.shotId === shot\.id/)
  assert.match(source, /Marker kamera akan tetap ada di Floorplan, tetapi tautannya akan dilepas/)
})

test('deleting a scene removes its floorplan layout as well as its shots', async () => {
  const source = await readSource('../src/components/ShotList.jsx')

  assert.match(source, /onChange\(prev => prev\.filter\(s => s\.id !== sceneToDelete\.id\)\)/)
  assert.match(source, /delete next\[sceneToDelete\.id\]/)
})

test('project and planning data are included in the print report input', async () => {
  const source = await readSource('../src/App.jsx')

  assert.ok(source.includes('<PrintReport project={project} scenes={scenes} floorplans={resolvedFloorplans}'))
})

test('backup import has a pre-read size limit and validates before replacing active state', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /MAX_BACKUP_FILE_SIZE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(source, /file\.size > MAX_BACKUP_FILE_SIZE_BYTES/)
  assert.match(source, /JSON\.parse\(.*text/s)
  assert.ok(source.includes('setScenes(migratedTarget.scenes)'))
  assert.match(source, /catch \(error\) \{[\s\S]*?could not import backup/i)
})

test('local Room Reusable migration extracts per-Scene rooms without geometry deduplication', async () => {
  const source = await readSource('../src/App.jsx')
  const floorplan = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /function migrateReusableRooms\(savedScenes, savedFloorplans, savedRooms = \[\]\)/)
  assert.match(source, /scene\.roomIds\.push\(room\.id\)/)
  assert.match(source, /projectRooms/)
  assert.match(source, /rooms: Array\.isArray\(rooms\) \? rooms : \[\]/)
  assert.match(floorplan, /projectRooms\.filter\(room => \(scene\.roomIds \|\| \[\]\)\.includes\(room\.id\)\)/)
  assert.match(floorplan, /Room digunakan bersama/)
  assert.match(source, /const resolvedFloorplans = projectRooms === null/)
})

test('local backup project records include reusable rooms and Scene references', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /rooms: projectRooms \|\| \[\]/)
  assert.match(source, /const backup = \{[\s\S]*?projects: savedProjects/)
  assert.match(source, /migrateReusableRooms\(targetScenes, target\.floorplans, target\.rooms\)/)
})

test('Room picker keeps every project Room visible across Scenes and marks current Scene usage', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /projectRooms\.map\(room =>/)
  assert.match(source, /disabled=\{alreadyUsed\}/)
  assert.match(source, /sudah dipakai di scene ini/)
  assert.match(source, /digunakan scene lain/)
})

test('Locked objects remain selectable but cannot move or resize', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const dragHandler = source.slice(source.indexOf('const beginObjectDrag'), source.indexOf('const beginWaypointDrag'))

  assert.match(source, /locked: !selectedEntity\.locked/)
  assert.match(dragHandler, /if \(item\.locked \|\| \(tool === 'room' && type !== 'room'\) \|\| \(tool === 'wall' && type !== 'wall'\)\) return/)
  assert.match(dragHandler, /if \(item\.locked \|\| \(tool === 'room' && type !== 'room'\) \|\| \(tool === 'wall' && type !== 'wall'\)\) return/)
  assert.match(source, /const beginResize = \(type, item, sx, sy, event\) => \{[\s\S]*?if \(item\.locked\) return/)
  assert.match(source, /!entry\.original\.locked/)
})

test('Rooms use editable polygon vertices and a manually entered ceiling height', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /const getRoomPoints = room =>/)
  assert.match(source, /const pointInPolygon =/)
  assert.match(source, /const beginRoomVertexDrag =/)
  assert.match(source, /mode: 'room-vertex'/)
  assert.match(source, /id="room-ceiling-height"/)
  assert.match(source, /placeholder="Belum diisi"/)
  assert.match(source, /Room hasil migrasi tidak diberi tinggi otomatis/)
  // Polygon Rooms expose editable overall bounds (not a legacy rectangle width),
  // while individual edge lengths are rendered separately and manual drawing
  // accepts a length in meters. All inspector dimension controls respect Room lock.
  assert.match(source, /id="room-length"/)
  assert.match(source, /id="room-width"/)
  assert.match(source, /disabled=\{Boolean\(selectedEntity\.locked\)\} onChange=\{event =>/)
  assert.match(source, /const resizeRoomBounds = \(room, dimension, targetUnits\) =>/)
  assert.match(source, /const confirmManualRoomLength =/)
  assert.match(source, /aria-label="Panjang garis dalam meter"/)
  assert.match(source, /getRoomPoints\(selectedEntity\)\.length/)
  assert.match(source, /step="0\.01"/)
})

test('Room dimensions are shown outside every polygon edge and can be toggled', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const getRoomDimensionGeometry =/)
  assert.match(source, /showRoomDimensions && \(\(\) => \{/ )
  assert.match(source, /aria-pressed=\{showRoomDimensions\}/)
  assert.match(source, /\(edge\.length \/ 100\)\.toFixed\(2\) \+ ' m'/)
})

test('Wall drawing captures pointer events on existing Rooms and snaps endpoints to Room and wall geometry', async () => {
  const source = await readFile(new URL('../src/components/Floorplan.jsx', import.meta.url), 'utf8')
  const captureStart = source.indexOf('const handleCanvasPointerDownCapture = event =>')
  const captureEnd = source.indexOf('const handleCanvasPointerDown = event =>', captureStart)
  const capture = source.slice(captureStart, captureEnd)
  assert.match(capture, /tool === 'wall'.*event\.button === 0/s)
  assert.match(capture, /event\.stopPropagation\(\)/)
  assert.match(capture, /setDrawStart\(snapped\.point\)/)
  assert.match(source, /const snapPointToRoomAndWallGeometry = \(point, origin = null\) =>/)
  assert.match(source, /snapRoomPoint\(point, origin, anchors, snapTolerance\)/)
  assert.match(source, /if \(tool === 'wall'\) \{\s*if \(event\.altKey\)/)
})

test('Room drawing snaps positionally to existing vertices with alignment guides and Alt bypass', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const snapping = await readSource('../src/utils/roomSnapping.js')
  assert.match(source, /import \{ snapRoomPoint \} from '\.\.\/utils\/roomSnapping'/)
  assert.match(source, /\.\.\.layout\.rooms\.flatMap\(room => getRoomPoints\(room\)\)/)
  assert.match(snapping, /const xAnchor = nearestOnAxis\(point\.x, 'x'\)/)
  assert.match(snapping, /const yAnchor = nearestOnAxis\(point\.y, 'y'\)/)
  assert.match(snapping, /if \(xAnchor\) guides\.push\(\{ axis: 'vertical'/)
  assert.match(snapping, /if \(yAnchor\) guides\.push\(\{ axis: 'horizontal'/)
  assert.match(snapping, /return \{ point: \{ x: snappedX, y: snappedY \}, guides \}/)
  assert.match(source, /svgRef\.current\?\.getBoundingClientRect\(\)\?\.width \|\| canvasSize\.width/)
  assert.match(source, /event\.altKey/)
  assert.match(source, /roomSnapGuides\.map/)
  assert.match(source, /strokeDasharray="5 4"/)
  assert.match(source, /9 \* viewBox\.width/)
})

test('Room snapping combines X and Y from different vertices and keeps single-axis snapping', () => {
  const origin = { x: 100, y: 100 }
  const vertexX = { x: 300, y: 200 }
  const vertexY = { x: 500, y: 400 }

  const both = snapRoomPoint({ x: 304, y: 396 }, origin, [vertexX, vertexY], 8)
  assert.deepEqual(both.point, { x: 300, y: 400 })
  assert.deepEqual(both.guides.map(guide => guide.axis).sort(), ['horizontal', 'vertical'])

  const onlyX = snapRoomPoint({ x: 304, y: 270 }, origin, [vertexX, vertexY], 8)
  assert.deepEqual(onlyX.point, { x: 300, y: 270 })
  assert.deepEqual(onlyX.guides.map(guide => guide.axis), ['vertical'])

  const onlyY = snapRoomPoint({ x: 650, y: 396 }, origin, [vertexX, vertexY], 8)
  assert.deepEqual(onlyY.point, { x: 650, y: 400 })
  assert.deepEqual(onlyY.guides.map(guide => guide.axis), ['horizontal'])
})

test('Room dimension layout uses consistent exterior lanes and suppresses duplicate total dimensions', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const getRoomDimensionLayouts = \(room, edges\) =>/)
  assert.match(source, /const offset = 72 \+ level \* 30/)
  assert.match(source, /const horizontalIsSingleEdge = outerGroupEdges\.some/)
  assert.match(source, /const verticalIsSingleEdge = outerGroupEdges\.some/)
  assert.match(source, /!horizontalIsSingleEdge/)
  assert.match(source, /!verticalIsSingleEdge/)
  assert.match(source, /opacity=\{active \? 1 : 0\.58\}/)
  assert.match(source, /strokeWidth="5" paintOrder="stroke"/)
})

test('Room dimensions distinguish individual wall lengths from overall bounds and keep openings draggable', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /m total/)
  assert.match(source, /y1 = y2 = guideY/)
  assert.match(source, /x1 = x2 = guideX/)
  assert.match(source, /angle: 0/)
  const roomRenderStart = source.indexOf('layout.rooms.map(room => {')
  const roomRenderEnd = source.indexOf('layout.walls.map', roomRenderStart)
  assert.notEqual(roomRenderStart, -1, 'Room polygon render block must exist')
  assert.notEqual(roomRenderEnd, -1, 'Room render block must end before wall render block')
  const roomRender = source.slice(roomRenderStart, roomRenderEnd)
  assert.match(roomRender, /key=\{'edge-hit-' \+ edge\.edgeIndex\}/)
  assert.match(roomRender, /stroke="transparent" strokeWidth="14"/)
  assert.match(roomRender, /beginRoomEdgeDrag\(room, edge\.edgeIndex, event\)/)
  assert.match(roomRender, /beginOpeningDrag\('room', room, opening, event\)/)
  assert.match(roomRender, /openings\.map\(opening =>/)
})

test('Door leaf mode can be toggled in-place without replacing or resetting opening data', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.equal((source.match(/id=\{opening\.id \+ '-leaf-mode'\}/g) || []).length, 2, 'Room and Wall inspectors both expose the door mode selector')
  assert.match(source, /value=\{opening\.type === 'door' \? 'leaf' : 'no-leaf'\}/)
  assert.match(source, /updateOpening\(opening\.id, \{ type: event\.target\.value === 'leaf' \? 'door' : 'doorway' \}\)/)
  assert.match(source, /const next = \{ \.\.\.opening, \.\.\.patch \}/, 'Updating type retains the existing opening record fields')
  assert.match(source, /opening\.type === 'doorway' \? null/, 'A door without a leaf does not render a leaf or swing arc')
})

test('Door opening controls expose swing direction and single or double leaves', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const DoorSwingSymbol =/)
  assert.match(source, /opening\.swingDirection === 'out'/)
  assert.match(source, /opening\.doorType === 'double'/)
  assert.match(source, /opening\.id \+ '-swing'/)
  assert.match(source, /opening\.id \+ '-door-type'/)
  assert.match(source, /const offset = 72/)
})
test('Dragging a Room edge translates both endpoint vertices in parallel', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const beginRoomEdgeDrag =/)
  assert.match(source, /mode: 'room-edge'/)
  assert.match(source, /const distance = dx \* nx \+ dy \* ny/)
  assert.match(source, /index === drag\.edgeIndex \|\| index === \(drag\.edgeIndex \+ 1\) % drag\.originalPoints\.length/)
  assert.match(source, /beginRoomEdgeDrag\(room, edge\.edgeIndex, event\)/)
})

test('Room drawing is point-by-point with close, Escape, live dimensions and manual lengths', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /const addRoomDrawingPoint = point =>/)
  assert.match(source, /const finishRoomDrawing = points =>/)
  assert.match(source, /setRoomDrawPoints\(points => \[\.\.\.points, snappedPoint\]\)/)
  assert.match(source, /const confirmManualRoomLength =/)
  assert.match(source, /Panjang garis dalam meter/)
  assert.match(source, /roomDrawPoints.length && key === 'enter'/)
  assert.match(source, /roomDrawPoints.length && key === 'tab'/)
  assert.match(source, /roomDrawPoints.length\) \{/)
})

test('Room migration converts legacy rectangles and remaps openings without assigning ceiling height', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /function normalizeRoomPolygon\(room, index = 0\)/)
  assert.match(source, /\{ x, y \}, \{ x: x \+ width, y \}, \{ x: x \+ width, y: y \+ height \}, \{ x, y: y \+ height \}/)
  assert.match(source, /const oldSideToEdge = \{ top: 0, right: 1, bottom: 2, left: 3 \}/)
  assert.match(source, /delete next\.side/)
  assert.match(source, /legacyRectangle && \['bottom', 'left'\]\.includes\(next\.side\)\) next\.offset = 1 - next\.offset/)
  assert.match(source, /migrated\.rooms/)
  assert.match(source, /Number\.isFinite\(Number\(room\.ceilingHeight\)\)/)
})

test('Room PDF export uses polygon outlines and polygon-edge opening positions', async () => {
  const source = await readSource('../src/components/PrintReport.jsx')

  assert.match(source, /function roomPoints\(room\)/)
  assert.match(source, /function roomEdges\(room\)/)
  assert.match(source, /<polygon key=\{'room-fill-' \+ room\.id\}/)
  assert.match(source, /Number\.isInteger\(opening\.edgeIndex\)/)
})

test('Props have editable names and manual dimensions in meters', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /id="prop-label"/)
  assert.match(source, /id="prop-type"/)
  assert.match(source, /id="prop-width"/)
  assert.match(source, /id="prop-height"/)
  assert.match(source, /selectedEntity\.locked\)\} onChange/)
})

test('Object locking prevents moving, resizing, rotating, and editing paths or openings', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /Kunci Objek/)
  assert.match(source, /if \(tool === 'pan' \|\| item\.locked\) return/)
  assert.match(source, /if \(tool === 'pan' \|\| wall\.locked\) return/)
  assert.match(source, /if \(tool === 'pan' \|\| host\.locked\) return/)
  assert.match(source, /!entry\.original\.locked/)
  assert.match(source, /selectedEntity\.locked \|\| !selectedType/)
})

test('Props Custom type accepts free text and displays the entered type/name', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /id="prop-custom-type"/)
  assert.match(source, /customPropType: event\.target\.value/)
  assert.match(source, /if \(type === 'prop'\) return item\.label \|\| item\.customPropType \|\| item\.propType \|\| 'Prop'/)
})

test('Doors and windows support precise width, position, and polygon edge controls', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /const updateOpening = \(openingId, patch\) =>/)
  assert.match(source, /id=\{opening\.id \+ '-width'\}/)
  assert.match(source, /id=\{opening\.id \+ '-offset'\}/)
  assert.match(source, /id=\{opening\.id \+ '-edge'\}/)
  assert.match(source, /updateOpening\(opening\.id, \{ width: Math\.round\(clamp\(meters, 0, 5\) \* 100\) \}\)/)
  assert.match(source, /updateOpening\(opening\.id, \{ offset: percent \/ 100 \}\)/)
  // Openings are attached to a polygon edge by edgeIndex, not legacy cardinal sides.
  assert.match(source, /id=\{opening\.id \+ '-edge'\}/)
  assert.match(source, /value=\{Number\.isInteger\(opening\.edgeIndex\) \? opening\.edgeIndex : 0\}/)
  assert.match(source, /getRoomEdges\(selectedEntity\)\.map\(edge => <option key=\{edge\.edgeIndex\} value=\{edge\.edgeIndex\}>/)
  assert.match(source, /updateOpening\(opening\.id, \{ edgeIndex: Number\(event\.target\.value\) \}\)/)
  assert.match(source, /disabled=\{Boolean\(selectedEntity\.locked\)\}/)
})

test('restoring active project preserves canonical reusable Rooms when legacy top-level floorplans exist', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /const sourceRooms = Array\.isArray\(savedState\?\.rooms\)\s*\? savedState\.rooms\s*:\s*\(savedProjectRecord\?\.rooms \|\| \[\]\)/)
})

test('Room opening normalization preserves the full supported 5-meter width', async () => {
  const source = await readSource('../src/App.jsx')

  assert.ok(source.includes('width: Math.max(12, Math.min(500, Number(opening.width)'))
})


test('Floorplan navigation supports shared cursor-anchored zoom, pinch, and explicit 1:1 reset', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const zoomCanvas = \(factor, clientX, clientY\) =>/)
  assert.match(source, /zoomCanvas\(event\.deltaY < 0 \? 0\.9 : 1\.1, event\.clientX, event\.clientY\)/)
  assert.match(source, /onTouchStart=\{handleCanvasTouchStart\}/)
  assert.match(source, /onTouchMove=\{handleCanvasTouchMove\}/)
  assert.match(source, /pinchRef\.current\.distance \/ distance/)
  assert.match(source, /const resetZoom = \(\) => setViewBox/)
  assert.match(source, /Reset zoom ke 100% \(1:1\)/)
  assert.match(source, /Muat seluruh denah ke kanvas/)
  assert.match(source, /<aside className="floorplan-inspector" onWheel=\{event => event\.stopPropagation\(\)\} style=\{\{ overscrollBehavior: 'contain' \}\}>/)
})

test('Floorplan pan capture takes priority over object interactions and select-box is blank-canvas only', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const handleCanvasPointerDownCapture = event =>/)
  assert.match(source, /event\.button !== 1 && !\(event\.button === 0 && spaceHeld\) && tool !== 'pan'/)
  assert.match(source, /onPointerDownCapture=\{handleCanvasPointerDownCapture\}/)
  assert.match(source, /const clickedObject = event\.target\?\.closest\?\.\('\[data-floorplan-object="true"\], \[data-floorplan-waypoint="true"\]'\)/)
  assert.match(source, /box\.right >= bounds\.left && box\.left <= bounds\.right/)
  assert.match(source, /if \(event\.code === 'Space'\) setSpaceHeld\(false\)/)
})

test('Floorplan Escape deselects and shortcuts ignore editable fields; Path drag handlers remain separate', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /if \(key === 'escape'\) \{[\s\S]*?applyEntitySelection\(\[\]\)/)
  assert.match(source, /target\.isContentEditable \|\| \['INPUT', 'TEXTAREA', 'SELECT'\]\.includes\(target\.tagName\)/)
  const objectDrag = source.slice(source.indexOf('const beginObjectDrag'), source.indexOf('const beginWaypointDrag'))
  const waypointDrag = source.slice(source.indexOf('const beginWaypointDrag'), source.indexOf('const beginRotate'))
  assert.match(objectDrag, /if \(item\.locked \|\| \(tool === 'room' && type !== 'room'\) \|\| \(tool === 'wall' && type !== 'wall'\)\) return/)
  assert.match(waypointDrag, /mode: 'waypoint'/)
  assert.match(source, /const appendWaypoint =/)
})


test('Path clicks capture before overlapping Room or Prop handlers can steal selection', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /if \(tool === 'path' && event\.button === 0\) \{[\s\S]*?event\.stopPropagation\(\)[\s\S]*?return/)
  assert.match(source, /const handleCanvasClickCapture = event => \{[\s\S]*?if \(tool !== 'path'\) return[\s\S]*?appendWaypoint\(getPoint\(event\)\)/)
  assert.match(source, /onClickCapture=\{handleCanvasClickCapture\}/)
})


test('Leafless doorway is a distinct opening type with editable label and direction', async () => {
  const floorplan = await readSource('../src/components/Floorplan.jsx')
  const app = await readSource('../src/App.jsx')
  const report = await readSource('../src/components/PrintReport.jsx')

  assert.match(floorplan, /addOpening\('doorway'\)/)
  assert.match(floorplan, /opening\.type === 'doorway' \? null/)
  assert.match(floorplan, /id=\{opening\.id \+ '-label'\}/)
  assert.match(floorplan, /opening\.type === 'doorway' && <>/)
  assert.match(app, /\['window', 'doorway'\]\.includes\(opening\.type\)/)
  assert.match(app, /opening\.type === 'doorway'.*label:/)
  assert.match(report, /opening\.type === 'doorway' \? \(opening\.label \|\| 'Pintu Tanpa Daun'\)/)
})


test('Leafless doorway uses an open-gap icon rather than the door-leaf symbol', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /type === 'doorway' \? \([\s\S]*?M-20 -5 H-8 M8 -5 H20 M-20 5 H-8 M8 5 H20/)
  assert.match(source, /<FloorplanObjectIcon type="doorway" size=\{18\} \/> Tambah pintu tanpa daun/)
})


test('Double doors render two leaves and matching swing arcs in the PDF floorplan', async () => {
  const source = await readSource('../src/components/PrintReport.jsx')
  assert.match(source, /opening\.doorType === 'double' \? \(\(\) =>/)
  assert.match(source, /const leaf = width \/ 2/)
  assert.match(source, /M ' \+ \(-width \/ 2\) \+ ' 0 L ' \+ \(-width \/ 2\) \+ ' ' \+ \(direction \* leaf\)/)
  assert.match(source, /opening\.swingDirection === 'out' \? -1 : 1/)
})


test('PDF floorplan scales the full measured plan to keep outer dimensions in frame', async () => {
  const source = await readSource('../src/components/PrintReport.jsx')
  assert.match(source, /const planScale = planBounds \? Math\.min\(/)
  assert.match(source, /900 \/ \(planBounds\.maxX - planBounds\.minX \+ 360/)
  assert.match(source, /570 \/ \(planBounds\.maxY - planBounds\.minY \+ 360/)
  assert.match(source, /scale\(' \+ planScale \+ '\)/)
})


test('Door hinge side supports left and right in Floorplan, persistence, and PDF', async () => {
  const floorplan = await readSource('../src/components/Floorplan.jsx')
  const app = await readSource('../src/App.jsx')
  const report = await readSource('../src/components/PrintReport.jsx')
  assert.match(floorplan, /opening\.id \+ '-hinge-side'/)
  assert.match(floorplan, /option value="left">Kiri/)
  assert.match(floorplan, /option value="right">Kanan/)
  assert.match(floorplan, /const hingeSide = opening\.hingeSide === 'right' \? 'right' : 'left'/)
  assert.match(app, /hingeSide: opening\.hingeSide === 'right' \? 'right' : 'left'/)
  assert.match(report, /const hingeX = opening\.hingeSide === 'right' \? width \/ 2 : -width \/ 2/)
})


test('Room merge prompts after a room is moved near an aligned shared edge', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const merge = await readSource('../src/utils/roomMerge.js')
  assert.match(source, /const currentLayout = layoutRef\.current \|\| layout[\s\S]*?findRoomMergeCandidate\(movedRoom, currentLayout\.rooms, 18\)/)
  assert.match(source, /Gabungkan kedua Room\?/)
  assert.match(source, /const confirmRoomMerge = \(\) => \{/)
  assert.doesNotMatch(source.slice(source.indexOf('const confirmRoomMerge = () => {'), source.indexOf('const addRoomVertexAtEdgeMidpoint')), /mergeAdjacentRoomPolygons/)
  assert.doesNotMatch(source.slice(source.indexOf('const confirmRoomMerge = () => {'), source.indexOf('const addRoomVertexAtEdgeMidpoint')), /rooms: previous\.rooms\.filter\(room => room\.id !== moving\.id\)/)
  assert.match(merge, /export function findRoomMergeCandidate/)
  assert.match(merge, /export function mergeAdjacentRoomPolygons/)
})

test('Double-clicking a Room vertex offers to start a new Room from that point', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /onDoubleClick=\{event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); setRoomVertexPrompt/)
  assert.match(source, /setRoomDrawPoints\(\[point\]\)/)
  assert.match(source, /Buat Room baru/)
})

test('Double-clicking a Room edge inserts a new editable vertex on that edge', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const addRoomVertexOnEdge = \(room, edgeIndex, event\) =>/)
  assert.match(source, /nextPoints\.splice\(edgeIndex \+ 1, 0, point\)/)
  assert.match(source, /onDoubleClick=\{event => addRoomVertexOnEdge\(room, edge\.edgeIndex, event\)\}/)
  assert.match(source, /Avoid creating a duplicate vertex close to either endpoint/)
})

test('Delete and Backspace remove a selected Room vertex without allowing invalid polygons', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const deleteSelectedRoomVertex = \(\) =>/)
  assert.match(source, /if \(points\.length <= 3\)/)
  assert.match(source, /const nextPoints = points\.filter\(\(_, index\) => index !== vertexIndex\)/)
  assert.match(source, /if \(area < 16\)/)
  assert.match(source, /if \(selectedRoomVertex\) \{[\s\S]*?deleteSelectedRoomVertex\(\)/)
  assert.match(source, /setSelectedRoomVertex\(\{ roomId: room\.id, vertexIndex \}\)/)
})

test('Room inspector exposes explicit add/remove vertex controls', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /addRoomVertexAtEdgeMidpoint/)
  assert.match(source, /Tambah titik pada sisi terpilih/)
  assert.match(source, /Hapus titik terpilih/)
  assert.match(source, /selectedRoomVertex\?\.roomId !== selectedEntity\.id/)
})

test('Room edge selection persists when moving from canvas to inspector vertex controls', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /onClick=\{event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); setHoveredRoomEdge\(\{ roomId: room\.id, edgeIndex: edge\.edgeIndex \}\)/)
  assert.match(source, /Tambah titik pada sisi terpilih/)
  assert.match(source, /selectedEntity\.id\} onClick=\{\(\) => addRoomVertexAtEdgeMidpoint\(selectedEntity\)\}/)
})

test('Room vertex insertion uses a persistent selected edge, not transient hover state', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const \[selectedRoomEdge, setSelectedRoomEdge\] = useState\(null\)/)
  assert.match(source, /setSelectedRoomEdge\(\{ roomId: room\.id, edgeIndex \}\)/)
  assert.match(source, /if \(!room \|\| room\.locked \|\| selectedRoomEdge\?\.roomId !== room\.id\) return/)
  assert.match(source, /disabled=\{Boolean\(selectedEntity\.locked\) \|\| selectedRoomEdge\?\.roomId !== selectedEntity\.id\}/)
})

test('connecting adjacent Rooms preserves both Room records, labels, walls, and openings', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const start = source.indexOf('const confirmRoomMerge = () => {')
  const end = source.indexOf('\n  const addRoomVertexAtEdgeMidpoint', start)
  assert.ok(start >= 0 && end > start, 'Room connection handler should exist')
  const handler = source.slice(start, end)
  assert.match(handler, /applyEntitySelection/)
  assert.match(handler, /setRoomMergePrompt\(null\)/)
  assert.doesNotMatch(handler, /mergeAdjacentRoomPolygons/)
  assert.doesNotMatch(handler, /rooms: previous\.rooms\.filter/)
  assert.match(source, /mọi dinding|semua dinding|dinding, pintu, dan jendela/i)
})

test('Room connections persist independently of selection and Rooms remain draggable', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const start = source.indexOf('const confirmRoomMerge = () => {')
  const end = source.indexOf('const addRoomVertexAtEdgeMidpoint', start)
  const handler = source.slice(start, end)
  assert.match(handler, /connectedRoomIds/)
  assert.match(handler, /connectedRoomIds\.add\(room\.id === moving\.id \? target\.id : moving\.id\)/)
  assert.match(source, /onPointerDown=\{event => beginObjectDrag\('room', room, event\)\}/)
  assert.match(source, /if \(drag\.type === 'room'\)[\s\S]*?points: getRoomPoints\(drag\.original\)\.map/)
  assert.match(source, /A connected Room behaves like an opening hosted on a wall/)
  assert.match(source, /attachmentVector = \{ x: \(edge\.b\.x - edge\.a\.x\) \/ length, y: \(edge\.b\.y - edge\.a\.y\) \/ length \}/)
  assert.match(source, /if \(drag\.type === 'room' && drag\.attachmentVector\)/)
  assert.match(source, /const alongWall = dx \* drag\.attachmentVector\.x \+ dy \* drag\.attachmentVector\.y/)
  assert.match(source, /if \(type !== 'room' && alreadySelected && currentSelection\.length > 1\)/)
  assert.match(source, /if \(candidate && !alreadyConnected\) setRoomMergePrompt\(candidate\)/)
})

test('existing Rooms remain draggable while Room drawing tool is active', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /if \(item\.locked \|\| \(tool === 'room' && type !== 'room'\) \|\| \(tool === 'wall' && type !== 'wall'\)\) return/)
})

test('Room tool switches to move mode when dragging an existing Room and inspector can disconnect it', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /if \(tool === 'path' \|\| \(tool === 'room' && type === 'room'\)\) setTool\('select'\)/)
  assert.match(source, /Lepaskan sambungan Room/)
  assert.match(source, /connectedRoomIds: \(room\.connectedRoomIds \|\| \[\]\)\.filter\(id => id !== selectedEntity\.id\)/)
})

test('dragging a connected Room keeps it hosted to its shared wall', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /A connected Room behaves like an opening hosted on a wall/)
  assert.match(source, /attachmentVector = \{ x: \(edge\.b\.x - edge\.a\.x\) \/ length, y: \(edge\.b\.y - edge\.a\.y\) \/ length \}/)
  assert.match(source, /if \(drag\.type === 'room' && drag\.attachmentVector\)/)
  assert.match(source, /const alongWall = dx \* drag\.attachmentVector\.x \+ dy \* drag\.attachmentVector\.y/)
  assert.match(source, /if \(type !== 'room' && alreadySelected && currentSelection\.length > 1\)/)
  assert.match(source, /if \(candidate && !alreadyConnected\) setRoomMergePrompt\(candidate\)/)
})

test('Connected Rooms use one combined bounding box for overall dimensions', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const connectedRoomGroup = \(\(\) => \{/)
  assert.match(source, /const connectedGroupPoints = connectedRoomGroup\.flatMap\(getRoomPoints\)/)
  assert.match(source, /const totalBounds = hasConnectedRooms \? connectedBounds : bounds/)
  assert.match(source, /const isSharedBoundaryEdge = edge => connectedRoomGroup\.some/)
  assert.match(source, /const visibleDimensionLayouts = dimensionLayouts/)
  assert.match(source, /const groupTotalBounds = hasConnectedRooms \? connectedBounds : null/)
  assert.match(source, /m total gabungan/)
  assert.match(source, /\{edges\.map\(edge => \{/)
  assert.match(source, /const isDimensionGroupActive = active && hasConnectedRooms/)
  assert.match(source, /const outerGroupEdges = groupEdges\.filter\(edge => !isSharedBoundaryEdge\(edge\)\)/)
  assert.match(source, /const verticalIsSingleEdge = outerGroupEdges\.some/)
  assert.match(source, /\(totalBounds\.width \/ 100\)\.toFixed\(2\) \+ ' m total'/)
  assert.match(source, /\(totalBounds\.height \/ 100\)\.toFixed\(2\) \+ ' m total'/)
})

test('Confirming a Room connection snaps walls flush while retaining shared walls', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const handlerStart = source.indexOf('const confirmRoomMerge = () => {')
  const handlerEnd = source.indexOf('const addRoomVertexAtEdgeMidpoint', handlerStart)
  const handler = source.slice(handlerStart, handlerEnd)
  assert.match(handler, /const signedDistance = \(movingEdge\.a\.x - targetEdge\.a\.x\)/)
  assert.match(handler, /getRoomPoints\(room\)\.map\(point => \(\{ x: Math\.round\(point\.x \+ shift\.x\), y: Math\.round\(point\.y \+ shift\.y\) \}\)\)/)
  assert.match(source, /edges\.filter\(edge => !isSharedRoomEdge\(edge\)\)\.map/)
  assert.match(source, /const isSharedRoomEdge = edge => connectedRooms\.some/)
})

test('Room total length and width stay visible without hover while edge dimensions remain contextual', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /showRoomDimensions && \(\(\) => \{/)
  assert.match(source, /!horizontalIsSingleEdge/)
  assert.match(source, /!verticalIsSingleEdge/)
  assert.match(source, /\(active \|\| hoveredRoomEdge\?\.roomId === room\.id\) && visibleDimensionLayouts\.map/)
})
