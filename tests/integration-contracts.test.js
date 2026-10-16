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

test('Room lock prevents direct, resize, and group movement', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /locked: !selectedEntity\.locked/)
  assert.match(source, /type === 'room' && item\.locked/)
  assert.match(source, /collection === 'rooms' && entry\.original\?\.locked/)
  assert.match(source, /if \(item\.locked\) return item/)
})

test('Room dimensions can be entered manually in meters and respect Room lock', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /id="room-width"/)
  assert.match(source, /id="room-height"/)
  assert.match(source, /type="number"/)
  assert.match(source, /Math\.round\(meters \* 100\)/)
  assert.match(source, /disabled=\{Boolean\(selectedEntity\.locked\)\}/)
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
