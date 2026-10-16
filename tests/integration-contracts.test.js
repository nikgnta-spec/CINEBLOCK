import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
  assert.match(dragHandler, /applyEntitySelection\(\[\{ type, id: item\.id \}\], \{ type, id: item\.id \}\)/)
  assert.match(dragHandler, /if \(item\.locked \|\| tool === 'room' \|\| tool === 'wall'\) return/)
  assert.match(source, /const beginResize = \(type, item, sx, sy, event\) => \{\n    if \(tool === 'pan'\) return[\s\S]*?setSelected\(\{ type, id: item\.id \}\)\n    if \(item\.locked\) return/)
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
  assert.match(source, /showRoomDimensions && \(active \|\| hoveredRoomEdge\?\.roomId === room\.id\)/)
  assert.match(source, /aria-pressed=\{showRoomDimensions\}/)
  assert.match(source, /\(edge\.length \/ 100\)\.toFixed\(2\) \+ ' m'/)
})

test('Room drawing snaps positionally to existing vertices with alignment guides and Alt bypass', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /const snapRoomPoint = \(point, origin, anchors, tolerance\) =>/)
  assert.match(source, /\.\.\.layout\.rooms\.flatMap\(room => getRoomPoints\(room\)\)/)
  assert.match(source, /bestXDistance = tolerance/)
  assert.match(source, /bestYDistance = tolerance/)
  assert.match(source, /snappedX = target\.value/)
  assert.match(source, /snappedY = target\.value/)
  assert.match(source, /svgRef\.current\?\.getBoundingClientRect\(\)\?\.width \|\| canvasSize\.width/)
  assert.match(source, /event\.altKey/)
  assert.match(source, /roomSnapGuides\.map/)
  assert.match(source, /strokeDasharray="5 4"/)
  assert.match(source, /9 \* viewBox\.width/)
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
  assert.match(source, /updateOpening\(opening\.id, \{ width: Math\.round\(meters \* 100\) \}\)/)
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

  assert.ok(source.includes(`const sourceRooms = Array.isArray(savedState?.rooms)
          ? savedState.rooms
          : (savedProjectRecord?.rooms || [])`))
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
  assert.match(objectDrag, /if \(item\.locked \|\| tool === 'room' \|\| tool === 'wall'\) return/)
  assert.match(waypointDrag, /mode: 'waypoint'/)
  assert.match(source, /const appendWaypoint =/)
})


test('Path clicks capture before overlapping Room or Prop handlers can steal selection', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /if \(tool === 'path' && event\.button === 0\) \{[\s\S]*?event\.stopPropagation\(\)[\s\S]*?return/)
  assert.match(source, /const handleCanvasClickCapture = event => \{[\s\S]*?if \(tool !== 'path'\) return[\s\S]*?appendWaypoint\(getPoint\(event\)\)/)
  assert.match(source, /onClickCapture=\{handleCanvasClickCapture\}/)
})
