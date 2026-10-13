import test from 'node:test'
import assert from 'node:assert/strict'
import { OptimisticConflictError, requireVersionedUpdate, supabaseClient } from '../src/lib/supabaseClient.js'

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

test('two simulated clients cannot both update the same stale version', async () => {
  const previousFetch = globalThis.fetch
  const previousStorage = globalThis.localStorage
  const previousStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const shotId = '22222222-2222-4222-8222-222222222222'
  let row = { id: shotId, version: 1, subject: 'Original', updated_at: '2026-01-01T00:00:00.000Z', updated_by: null }
  const store = new Map()
  const storage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const makeSession = token => JSON.stringify({
    access_token: token,
    refresh_token: 'refresh-' + token,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: token, email: token + '@example.test' },
  })
  storage.setItem('cineblock.supabase.session.v1', makeSession('user-a'))
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (options.method !== 'PATCH') throw new Error('Unexpected request in OCC test: ' + options.method)
    const expected = Number((parsed.searchParams.get('version') || '').replace('eq.', ''))
    if (expected !== row.version) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    row = { ...row, ...JSON.parse(options.body), version: row.version + 1, updated_by: options.headers.Authorization.slice(7) }
    return new Response(JSON.stringify([{ id: row.id, version: row.version, updated_at: row.updated_at, updated_by: row.updated_by }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const first = await supabaseClient.updateVersionedRow('cineblock_shots', {
      id: shotId, expectedVersion: 1, changes: { subject: 'Edited by A' },
    })
    assert.equal(first.version, 2)
    storage.setItem('cineblock.supabase.session.v1', makeSession('user-b'))
    await assert.rejects(
      supabaseClient.updateVersionedRow('cineblock_shots', {
        id: shotId, expectedVersion: 1, changes: { subject: 'Edited by B' },
      }),
      error => error instanceof OptimisticConflictError && error.code === 'CINEBLOCK_OCC_CONFLICT',
    )
    assert.equal(row.subject, 'Edited by A')
    assert.equal(row.version, 2)
    assert.equal(row.updated_by, 'user-a')
  } finally {
    globalThis.fetch = previousFetch
    if (previousStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', previousStorageDescriptor)
    else {
      try { delete globalThis.localStorage } catch { globalThis.localStorage = previousStorage }
    }
  }
})
