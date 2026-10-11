import test from 'node:test'
import assert from 'node:assert/strict'
import { loadAppState, selectNewestStorageRecord } from '../src/storage.js'

const record = (savedAt, title) => ({
  __cineblockStorageRecord: true,
  savedAt,
  state: { project: { title } },
})

function withBrowserStorage(rawValue, run) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const values = new Map()
  if (rawValue !== null) values.set('cineblock.app-state.v1', JSON.stringify(rawValue))

  globalThis.window = {
    localStorage: {
      getItem(key) {
        return values.get(key) ?? null
      },
      setItem(key, value) {
        values.set(key, String(value))
      },
    },
  }
  globalThis.indexedDB = undefined

  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
      if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB)
      else delete globalThis.indexedDB
    })
}

function withMockIndexedDB(initialRecord, run) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const values = new Map([['primary', initialRecord]])
  const localValues = new Map()
  let transactionCount = 0

  const database = {
    objectStoreNames: { contains: () => true },
    transaction(_storeName, mode) {
      transactionCount += 1
      const transaction = { oncomplete: null, onerror: null, onabort: null }
      transaction.objectStore = () => ({
        get(key) {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null }
          queueMicrotask(() => {
            request.result = values.get(key)
            request.onsuccess?.()
            queueMicrotask(() => transaction.oncomplete?.())
          })
          return request
        },
        put(value, key) {
          queueMicrotask(() => {
            if (mode !== 'readwrite') {
              transaction.error = new Error('Readonly transaction cannot write')
              transaction.onabort?.()
              return
            }
            values.set(key, value)
            transaction.oncomplete?.()
          })
        },
      })
      return transaction
    },
  }

  globalThis.indexedDB = {
    open() {
      const request = { result: database, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return localValues.get(key) ?? null
      },
      setItem(key, value) {
        localValues.set(key, String(value))
      },
    },
  }

  return Promise.resolve()
    .then(() => run({
      getStoredRecord: () => values.get('primary'),
      getTransactionCount: () => transactionCount,
    }))
    .finally(() => {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
      if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB)
      else delete globalThis.indexedDB
    })
}

test('prefers the newer timestamped localStorage fallback over stale IndexedDB', () => {
  const databaseRecord = record(100, 'old database')
  const fallbackRecord = record(200, 'new fallback')

  assert.equal(selectNewestStorageRecord(databaseRecord, fallbackRecord), fallbackRecord)
})

test('keeps IndexedDB when it has the newer timestamp', () => {
  const databaseRecord = record(300, 'new database')
  const fallbackRecord = record(200, 'old fallback')

  assert.equal(selectNewestStorageRecord(databaseRecord, fallbackRecord), databaseRecord)
})

test('prefers IndexedDB when both timestamped records have the same timestamp', () => {
  const databaseRecord = record(200, 'database')
  const fallbackRecord = record(200, 'fallback')

  assert.equal(selectNewestStorageRecord(databaseRecord, fallbackRecord), databaseRecord)
})

test('supports legacy unwrapped records without a timestamp', () => {
  const legacyDatabaseRecord = { tab: 'shotlist', project: { title: 'legacy database' } }
  const fallbackRecord = record(200, 'timestamped fallback')

  assert.equal(selectNewestStorageRecord(legacyDatabaseRecord, fallbackRecord), fallbackRecord)
})

test('returns a legacy fallback when IndexedDB has no record', () => {
  const legacyFallbackRecord = {
    __cineblockStorageRecord: true,
    savedAt: 0,
    state: { tab: 'shotlist', project: { title: 'legacy fallback' } },
  }

  assert.equal(selectNewestStorageRecord(null, legacyFallbackRecord), legacyFallbackRecord)
})

test('loads the timestamped fallback when IndexedDB is unavailable', async () => {
  const fallback = record(200, 'recovered project')

  await withBrowserStorage(fallback, async () => {
    const state = await loadAppState()
    assert.equal(state.project.title, 'recovered project')
  })
})

test('loads legacy localStorage state when IndexedDB is unavailable', async () => {
  const legacyState = { tab: 'shotlist', project: { title: 'legacy project' }, scenes: [] }

  await withBrowserStorage(legacyState, async () => {
    const state = await loadAppState()
    assert.deepEqual(state, legacyState)
  })
})

test('repairs stale IndexedDB with the newer localStorage fallback', async () => {
  const staleDatabaseRecord = record(100, 'old database')
  const newerFallbackRecord = record(200, 'new fallback')

  await withMockIndexedDB(staleDatabaseRecord, async database => {
    const fallback = newerFallbackRecord
    // Provide the newer backup through the mocked browser's compatibility storage.
    window.localStorage.setItem('cineblock.app-state.v1', JSON.stringify(fallback))

    const state = await loadAppState()
    assert.equal(state.project.title, 'new fallback')

    const repairedRecord = database.getStoredRecord()
    assert.equal(repairedRecord.__cineblockStorageRecord, true)
    assert.equal(repairedRecord.state.project.title, 'new fallback')
    assert.ok(repairedRecord.savedAt >= 200)
    assert.equal(database.getTransactionCount(), 2)
  })
})
