import test from 'node:test'
import assert from 'node:assert/strict'
import { SIZES, ANGLES, LENSES, MOVEMENTS, EQUIPMENT } from '../src/shotOptions.js'

const optionGroups = { SIZES, ANGLES, LENSES, MOVEMENTS, EQUIPMENT }

test('all shared shot dropdown option groups are non-empty strings', () => {
  for (const [name, options] of Object.entries(optionGroups)) {
    assert.ok(Array.isArray(options) && options.length > 0, name + ' must not be empty')
    assert.ok(options.every(option => typeof option === 'string' && option.trim()), name + ' contains an invalid option')
  }
})

test('shared shot dropdown option groups contain no duplicate values', () => {
  for (const [name, options] of Object.entries(optionGroups)) {
    assert.equal(new Set(options).size, options.length, name + ' contains duplicate options')
  }
})

test('movement options used for camera paths include every supported camera-path movement', async () => {
  const { readFile } = await import('node:fs/promises')
  const floorplan = await readFile(new URL('../src/components/Floorplan.jsx', import.meta.url), 'utf8')
  const pathMovementBlock = floorplan.match(/const CAMERA_PATH_MOVEMENTS = new Set\(\[([\s\S]*?)\]\)/)

  assert.ok(pathMovementBlock, 'Floorplan must declare camera path movements')
  const supportedMovements = [...pathMovementBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  for (const movement of supportedMovements) {
    assert.ok(MOVEMENTS.includes(movement), 'Camera path movement is missing from shared options: ' + movement)
  }
})
