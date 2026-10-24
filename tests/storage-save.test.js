import test from 'node:test'
import assert from 'node:assert/strict'
import { loadAppState, saveAppState, saveAppStateOnExit, selectNewestStorageRecord } from '../src/storage.js'

const STORAGE_KEY = 'cineblock.app-state.v1'

async function withUnavailableIndexedDB(run, { failWrites = false } = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const values = new Map()

  globalThis.indexedDB = undefined
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return values.get(key) ?? null
      },
      setItem(key, value) {
        if (failWrites) throw new Error('Storage quota exceeded')
        values.set(key, String(value))
      },
    },
  }

  try {
    await run({ values })
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB)
    else delete globalThis.indexedDB
  }
}

test('saveAppState writes a timestamped compatibility record when IndexedDB is unavailable', async () => {
  const state = { project: { title: 'saved through fallback' }, scenes: [{ id: 'scene-1' }] }

  await withUnavailableIndexedDB(async () => {
    await saveAppState(state)
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY))

    assert.equal(saved.__cineblockStorageRecord, true)
    assert.equal(saved.state.project.title, 'saved through fallback')
    assert.deepEqual(saved.state.scenes, [{ id: 'scene-1' }])
    assert.ok(Number.isFinite(saved.savedAt))
  })
})

test('concurrent saves preserve call order and leave the newest snapshot in fallback storage', async () => {
  const firstState = { project: { title: 'first snapshot' } }
  const newestState = { project: { title: 'newest snapshot' } }

  await withUnavailableIndexedDB(async () => {
    await Promise.all([
      saveAppState(firstState),
      saveAppState(newestState),
    ])

    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    assert.equal(saved.state.project.title, 'newest snapshot')
    assert.ok(Number.isFinite(saved.savedAt))
  })
})

test('loadAppState safely ignores malformed compatibility JSON', async () => {
  await withUnavailableIndexedDB(async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json')
    const state = await loadAppState()
    assert.equal(state, null)
  })
})

test('saveAppState rejects when both IndexedDB and compatibility storage fail', async () => {
  await withUnavailableIndexedDB(async () => {
    await assert.rejects(
      saveAppState({ project: { title: 'unsavable' } }),
      /Storage quota exceeded/,
    )
  }, { failWrites: true })
})


test('selectNewestStorageRecord ignores non-finite timestamps', () => {
  const olderDatabase = {
    __cineblockStorageRecord: true,
    savedAt: 100,
    state: { project: { title: 'database' } },
  }
  const invalidFallback = {
    __cineblockStorageRecord: true,
    savedAt: Number.POSITIVE_INFINITY,
    state: { project: { title: 'invalid fallback' } },
  }

  assert.equal(selectNewestStorageRecord(olderDatabase, invalidFallback), olderDatabase)
})

test('selectNewestStorageRecord prefers a genuinely newer timestamped fallback', () => {
  const database = {
    __cineblockStorageRecord: true,
    savedAt: 100,
    state: { project: { title: 'database' } },
  }
  const fallback = {
    __cineblockStorageRecord: true,
    savedAt: 200,
    state: { project: { title: 'fallback' } },
  }

  assert.equal(selectNewestStorageRecord(database, fallback), fallback)
})

test('saveAppStateOnExit writes the latest recovery snapshot synchronously', async () => {
  const state = { project: { title: 'last edit before refresh' }, scenes: [{ id: 'latest-scene' }] }

  await withUnavailableIndexedDB(async () => {
    const pendingSave = saveAppStateOnExit(state)
    const savedBeforeAwait = JSON.parse(window.localStorage.getItem(STORAGE_KEY))

    assert.equal(savedBeforeAwait.state.project.title, 'last edit before refresh')
    assert.deepEqual(savedBeforeAwait.state.scenes, [{ id: 'latest-scene' }])
    await pendingSave
  })
})
