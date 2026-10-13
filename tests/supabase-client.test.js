import test from 'node:test'
import assert from 'node:assert/strict'
import { OptimisticConflictError } from '../src/lib/supabaseClient.js'

test('OCC conflicts carry stable metadata for UI recovery', () => {
  const error = new OptimisticConflictError('cineblock_shots', 'shot-123', 4)
  assert.equal(error.name, 'OptimisticConflictError')
  assert.equal(error.code, 'CINEBLOCK_OCC_CONFLICT')
  assert.equal(error.table, 'cineblock_shots')
  assert.equal(error.id, 'shot-123')
  assert.equal(error.expectedVersion, 4)
  assert.match(error.message, /diubah pengguna lain/)
})
