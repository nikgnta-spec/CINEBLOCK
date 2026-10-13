import test from 'node:test'
import assert from 'node:assert/strict'
import { OptimisticConflictError, requireVersionedUpdate } from '../src/lib/supabaseClient.js'

test('OCC accepts exactly one row returned by the version-guarded update', () => {
  const updated = { id: 'shot-123', version: 5 }
  assert.equal(requireVersionedUpdate('cineblock_shots', updated.id, 4, [updated]), updated)
})

test('OCC reports a conflict when a stale version updates zero rows', () => {
  assert.throws(
    () => requireVersionedUpdate('cineblock_shots', 'shot-123', 4, []),
    error => error instanceof OptimisticConflictError
      && error.code === 'CINEBLOCK_OCC_CONFLICT'
      && error.expectedVersion === 4,
  )
})

test('OCC treats unexpected multi-row results as a conflict', () => {
  assert.throws(
    () => requireVersionedUpdate('cineblock_shots', 'shot-123', 4, [{ id: 'a' }, { id: 'b' }]),
    OptimisticConflictError,
  )
})
