import test from 'node:test'
import assert from 'node:assert/strict'
import { findRoomMergeCandidate, mergeAdjacentRoomPolygons } from '../src/utils/roomMerge.js'

test('merges two adjacent rectangular Rooms into one polygon and recalculates bounds', () => {
  const moving = { id: 'moving', label: 'Room 2', points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], openings: [] }
  const target = { id: 'target', label: 'Room 1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], openings: [] }
  const candidate = findRoomMergeCandidate(moving, [target], 18)
  assert.ok(candidate)
  const merged = mergeAdjacentRoomPolygons(moving, target, candidate)
  assert.ok(merged)
  assert.equal(merged.points.length, 6)
  const xs = merged.points.map(point => point.x)
  const ys = merged.points.map(point => point.y)
  assert.equal(Math.max(...xs) - Math.min(...xs), 200)
  assert.equal(Math.max(...ys) - Math.min(...ys), 100)
})

test('rejects merge when an opening is placed on the disappearing shared edge', () => {
  const moving = { id: 'moving', points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], openings: [{ id: 'door', edgeIndex: 3, offset: 0.5 }] }
  const target = { id: 'target', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], openings: [] }
  const candidate = findRoomMergeCandidate(moving, [target], 18)
  assert.ok(candidate)
  assert.equal(mergeAdjacentRoomPolygons(moving, target, candidate), null)
})

test('offers merge for small gaps by aligning matching Room edges', () => {
  const moving = { id: 'moving', points: [{ x: 105, y: 0 }, { x: 205, y: 0 }, { x: 205, y: 100 }, { x: 105, y: 100 }], openings: [] }
  const target = { id: 'target', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], openings: [] }
  const candidate = findRoomMergeCandidate(moving, [target], 18)
  assert.ok(candidate)
  assert.ok(mergeAdjacentRoomPolygons(moving, target, candidate))
})

test('merges adjacent Rooms when the shared edges have different lengths', () => {
  const moving = { id: 'moving', points: [{ x: 100, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 80 }, { x: 100, y: 80 }], openings: [] }
  const target = { id: 'target', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], openings: [] }
  const candidate = findRoomMergeCandidate(moving, [target], 18)
  assert.ok(candidate, 'partial shared edge should be a valid merge candidate')
  const merged = mergeAdjacentRoomPolygons(moving, target, candidate)
  assert.ok(merged, 'unequal room dimensions should merge')
  assert.ok(merged.points.length >= 6)
  const xs = merged.points.map(point => point.x)
  const ys = merged.points.map(point => point.y)
  assert.equal(Math.max(...xs) - Math.min(...xs), 180)
  assert.equal(Math.max(...ys) - Math.min(...ys), 100)
})

test('merges Rooms when the moving Room is taller than the target Room', () => {
  const moving = { id: 'moving', points: [{ x: 100, y: -50 }, { x: 160, y: -50 }, { x: 160, y: 150 }, { x: 100, y: 150 }], openings: [] }
  const target = { id: 'target', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], openings: [] }
  const candidate = findRoomMergeCandidate(moving, [target], 18)
  assert.ok(candidate)
  const merged = mergeAdjacentRoomPolygons(moving, target, candidate)
  assert.ok(merged)
  const ys = merged.points.map(point => point.y)
  assert.equal(Math.max(...ys) - Math.min(...ys), 200)
})
