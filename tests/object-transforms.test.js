import test from 'node:test'
import assert from 'node:assert/strict'
import { rotateObjectGroup } from '../src/utils/objectTransforms.js'

test('group rotation turns object positions and their individual angles around the group center', () => {
  const rotated = rotateObjectGroup([
    { id: 'left', x: 0, y: 0, angle: 10 },
    { id: 'right', x: 100, y: 0, angle: 350 },
  ], 90)

  assert.deepEqual(rotated.map(item => [item.x, item.y, item.angle]), [[50, -50, 100], [50, 50, 80]])
})

test('group rotation leaves locked objects out of the transform', () => {
  const rotated = rotateObjectGroup([
    { id: 'left', x: 0, y: 0 },
    { id: 'locked', x: 100, y: 0, angle: 30, locked: true },
    { id: 'right', x: 200, y: 0 },
  ], -90)

  assert.deepEqual(rotated.map(item => item.id), ['left', 'right'])
  assert.deepEqual(rotated.map(item => [item.x, item.y]), [[100, 100], [100, -100]])
})
