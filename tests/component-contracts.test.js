import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = path => readFile(new URL(path, import.meta.url), 'utf8')

test('camera creation links an unlinked shot or creates a paired shot when needed', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /const linkedShotIds = new Set\(layout\.cameras\.map\(camera => camera\.shotId\)\.filter\(Boolean\)\)/)
  assert.match(source, /scene\.shots\.find\(shot => !linkedShotIds\.has\(shot\.id\)\)/)
  assert.match(source, /targetShot = defaultShot\(scene\.shots\.length \+ 1\)/)
  assert.match(source, /object = \{ id: cameraId, .*shotId: targetShot\.id/)
})

test('camera create/delete undo and redo update linked shot records', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')

  assert.match(source, /const undoLayout = \(\) =>/)
  assert.match(source, /const redoLayout = \(\) =>/)
  assert.match(source, /autoShotsToRemove/)
  assert.match(source, /deletedShotsToRestore/)
  assert.match(source, /autoShotsToRestore/)
  assert.match(source, /deletedShotIdsToRemove/)
})

test('print report renders camera FOV from the lens of the linked shot', async () => {
  const source = await readSource('../src/components/PrintReport.jsx')

  assert.match(source, /const shot = shots\.find\(item => item\.id === camera\.shotId\)/)
  assert.match(source, /const fov = fovPath\(shot\?\.lens \|\| ''\)/)
  assert.match(source, /className="print-plan-page"/)
})

test('standalone Shot List and Storyboard PDF exports do not force a blank first page', async () => {
  const source = await readSource('../src/index.css')

  assert.match(source, /\.print-mode-shotlist \.print-shot-list-section,[\s\S]*?\.print-mode-storyboard \.print-shot-list-section \{ break-before: auto; \}/)
})

test('visual reference uploads enforce a size limit and clear the input after handling', async () => {
  const source = await readSource('../src/components/ProjectInfo.jsx')

  assert.match(source, /MAX_VISUAL_REFERENCE_SIZE_BYTES = 8 \* 1024 \* 1024/)
  assert.match(source, /file\.size > MAX_VISUAL_REFERENCE_SIZE_BYTES/)
  assert.match(source, /finally \{\s*input\.value = ''\s*\}/)
  assert.match(source, /refs\[idx\] = dataUrl/)
})

test('scene rename trims whitespace and supports Escape to cancel', async () => {
  const source = await readSource('../src/components/SceneNavigator.jsx')

  assert.match(source, /const nextName = draft\.trim\(\)/)
  assert.match(source, /if \(nextName && nextName !== scene\.name\) onRenameScene/)
  assert.match(source, /if \(event\.key === 'Escape'\)[\s\S]*?cancelRename\(scene\)/)
})

test('autosave is paused after an external-tab save conflict is detected', async () => {
  const source = await readSource('../src/App.jsx')

  assert.match(source, /externalSaveDetectedRef\.current = true/)
  assert.match(source, /if \(!hydrated \|\| !activeProjectId \|\| externalSaveDetectedRef\.current\) return undefined/)
  assert.match(source, /if \(externalSaveDetectedRef\.current\) return/)
})


test('movement path endpoints render the same object icon and name without a backing circle', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  const endpoint = source.slice(source.indexOf('data-floorplan-path-end-object="true"'), source.indexOf('{(showPath ? (object.path || []) : []).map'))
  assert.match(source, /data-floorplan-path-end-object="true"/)
  assert.match(source, /const movementWaypoints = showPath \? \(object\.path \|\| \[\]\) : \[\]/)
  assert.match(source, /const endpointName = type === 'actor'/)
  assert.match(endpoint, /\{endpointName\}/)
  assert.match(endpoint, /type === 'actor' \? \(/)
  assert.match(endpoint, /type === 'camera' \? \(/)
  assert.match(endpoint, /type === 'light' \? \(/)
  assert.doesNotMatch(endpoint, /<circle r="15"/)
})

test('reusable Rooms can be added to another Scene and edits update the Project Room collection', async () => {
  const source = await readSource('../src/components/Floorplan.jsx')
  assert.match(source, /Gunakan Room yang sudah dibuat/)
  assert.match(source, /roomIds: \[\.\.\.new Set\(\[\.\.\.\(item\.roomIds \|\| \[\]\), roomId\]\)\]/)
  assert.match(source, /onProjectRoomsChange\?\.\(previous =>/)
  assert.match(source, /byId\.set\(room\.id, room\)/)
})
