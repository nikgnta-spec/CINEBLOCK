import test from 'node:test'
import assert from 'node:assert/strict'
import { snapRoomToEdge } from './roomMerge.js'

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

test('snaps a slightly rotated room edge exactly onto the target wall line', () => {
  const room = { id: 'moving', points: [{ x: 102, y: 4 }, { x: 202, y: 7 }, { x: 202, y: 107 }, { x: 102, y: 104 }] }
  const movingEdge = { a: room.points[0], b: room.points[1], index: 0 }
  const targetEdge = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, index: 0 }
  const result = snapRoomToEdge(room, movingEdge, targetEdge)
  assert.ok(result)
  assert.ok(Math.abs(result[1].y - result[0].y) < 1e-8)
  assert.ok(Math.abs(result[0].y) < 1e-8)
  assert.ok(Math.abs(distance(result[0], result[1]) - distance(room.points[0], room.points[1])) < 1e-8)
  assert.ok(Math.abs(distance(result[1], result[2]) - distance(room.points[1], room.points[2])) < 1e-8)
})

test('rejects invalid and non-parallel edges without changing room geometry', () => {
  const room = { id: 'moving', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }
  assert.equal(snapRoomToEdge(room, null, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), null)
  assert.equal(snapRoomToEdge(room, { a: room.points[0], b: room.points[1] }, { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }), null)
  assert.deepEqual(room.points, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
})


test('snaps correctly when the target wall is stored in reverse vertex order', () => {
  const room = { id: 'moving', points: [{ x: 0, y: 3 }, { x: 100, y: 3 }, { x: 100, y: 103 }] }
  const movingEdge = { a: room.points[0], b: room.points[1], index: 0 }
  const targetEdge = { a: { x: 100, y: 0 }, b: { x: 0, y: 0 }, index: 0 }
  const result = snapRoomToEdge(room, movingEdge, targetEdge)
  assert.ok(result)
  assert.ok(Math.abs(result[0].y) < 1e-8)
  assert.ok(Math.abs(result[1].y) < 1e-8)
  assert.ok(Math.abs(distance(result[0], result[1]) - 100) < 1e-8)
})
