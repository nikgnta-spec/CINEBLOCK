import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeFloorplanAngle, normalizeFloorplanCoordinate } from '../src/utils/floorplanCoordinates.js'

test('saved floorplan coordinates keep the full workspace instead of clamping to the initial canvas', () => {
  assert.equal(normalizeFloorplanCoordinate(-125), -125)
  assert.equal(normalizeFloorplanCoordinate(1420), 1420)
  assert.equal(normalizeFloorplanCoordinate(-800), -800)
  assert.equal(normalizeFloorplanCoordinate(Number.NaN), 0)
  assert.equal(normalizeFloorplanCoordinate(2_000_000), 1_000_000)
})

test('saved floorplan angles preserve equivalent rotations', () => {
  assert.equal(normalizeFloorplanAngle(-45), 315)
  assert.equal(normalizeFloorplanAngle(450), 90)
  assert.equal(normalizeFloorplanAngle(Number.NaN), 0)
})

test('saved geometry, every object type, and movement paths use workspace coordinates', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

  assert.match(source, /const coords = value => normalizeFloorplanCoordinate\(value\)/)
  assert.match(source, /rooms: \(Array\.isArray\(raw\.rooms\)[\s\S]*?normalizeRoomPolygon\(item, index\)/)
  for (const collection of ['walls', 'props', 'actors', 'cameras', 'lights']) {
    assert.match(source, new RegExp(`${collection}: \\(Array\\.isArray\\(raw\\.${collection}\\)[\\s\\S]*?x: coords\\(item\\.x\\)`))
  }
  assert.match(source, /path: \(Array\.isArray\(item\.path\)[\s\S]*?x: coords\(point\?\.x\),\s*y: coords\(point\?\.y\)/)
})

test('opening a scene does not automatically move saved actor, camera, or light markers', async () => {
  const source = await readFile(new URL('../src/components/Floorplan.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /normalizedSceneLayoutsRef/)
  assert.doesNotMatch(source, /One-time repair of obvious old auto-placement collisions/)
  assert.match(source, /initialLayoutFitRef/)
})

test('Floorplan keeps marquee selection and exposes Select All by button and keyboard shortcut', async () => {
  const source = await readFile(new URL('../src/components/Floorplan.jsx', import.meta.url), 'utf8')

  assert.match(source, /mode: 'selection-box'/)
  assert.match(source, /if \(\(event\.ctrlKey \|\| event\.metaKey\) && key === 'a'\)/)
  assert.match(source, /onClick=\{selectAllObjects\}[^>]*title="Pilih semua objek di scene ini"/)
})
