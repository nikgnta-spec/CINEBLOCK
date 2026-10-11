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

  assert.match(source, /<PrintReport project=\{project\} scenes=\{scenes\} floorplans=\{floorplans\}/)
})

test('backup import has a pre-read size limit and validates before replacing active state', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /MAX_BACKUP_FILE_SIZE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(source, /file\.size > MAX_BACKUP_FILE_SIZE_BYTES/)
  assert.match(source, /JSON\.parse\(.*text/s)
  assert.match(source, /setScenes\(targetScenes\)/)
  assert.match(source, /catch \(error\) \{[\s\S]*?could not import backup/i)
})
