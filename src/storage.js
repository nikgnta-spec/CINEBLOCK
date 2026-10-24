const DATABASE_NAME = 'cineblock-local'
const DATABASE_VERSION = 1
const STORE_NAME = 'appState'
const PRIMARY_KEY = 'primary'
const LEGACY_STORAGE_KEY = 'cineblock.app-state.v1'
const CHANGE_EVENT_KEY = 'cineblock.app-state.changed'
const CHANNEL_NAME = 'cineblock-app-state'
const TAB_ID = typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `tab-${Math.random().toString(36).slice(2)}`

let databasePromise
let saveQueue = Promise.resolve()
let lastSavedAt = 0

function openDatabase() {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser'))
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Could not open local database'))
      request.onblocked = () => reject(new Error('Local database upgrade is blocked by another tab'))
    }).catch(error => {
      databasePromise = null
      throw error
    })
  }

  return databasePromise
}

function readFromDatabase(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(PRIMARY_KEY)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error || new Error('Could not read local database'))
    transaction.onabort = () => reject(transaction.error || new Error('Local database read was aborted'))
  })
}

function writeToDatabase(database, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(value, PRIMARY_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not save local database'))
    transaction.onabort = () => reject(transaction.error || new Error('Local database save was aborted'))
  })
}

function notifyOtherTabs() {
  try {
    const channel = typeof globalThis.BroadcastChannel !== 'undefined'
      ? new globalThis.BroadcastChannel(CHANNEL_NAME)
      : null
    channel?.postMessage({ type: 'saved', source: TAB_ID })
    channel?.close()
  } catch {
    // The storage event below remains a fallback when BroadcastChannel is unavailable.
  }

  try {
    globalThis.window.localStorage.setItem(CHANGE_EVENT_KEY, `${TAB_ID}:${Date.now()}:${Math.random()}`)
  } catch {
    // BroadcastChannel still works when localStorage is unavailable.
  }
}

export function subscribeToExternalSave(callback) {
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(CHANNEL_NAME)
    : null
  const handleMessage = event => {
    if (event.data?.type === 'saved' && event.data.source !== TAB_ID) callback()
  }
  const handleStorage = event => {
    if (event.key === CHANGE_EVENT_KEY && event.newValue && !event.newValue.startsWith(`${TAB_ID}:`)) {
      callback()
    }
  }

  channel?.addEventListener('message', handleMessage)
  globalThis.window.addEventListener('storage', handleStorage)

  return () => {
    channel?.removeEventListener('message', handleMessage)
    channel?.close()
    globalThis.window.removeEventListener('storage', handleStorage)
  }
}

function readLegacyLocalStorage() {
  try {
    const raw = globalThis.window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    // Newer saves carry a timestamp so fallback data can be compared with IndexedDB.
    if (parsed.__cineblockStorageRecord === true && parsed.state && typeof parsed.state === 'object') {
      return parsed
    }

    // Existing localStorage saves predate timestamped records.
    return { __cineblockStorageRecord: true, savedAt: 0, state: parsed }
  } catch (error) {
    console.warn('CINEBLOCK could not read the older browser save:', error)
    return null
  }
}

function createStorageRecord(state) {
  // Keep timestamps strictly increasing for saves queued within this tab, even when
  // multiple edits are persisted during the same millisecond or the system clock shifts.
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1)
  return { __cineblockStorageRecord: true, savedAt: lastSavedAt, state }
}

function unwrapStorageRecord(record) {
  return record?.__cineblockStorageRecord === true
    && record.state
    && typeof record.state === 'object'
    ? record.state
    : record && typeof record === 'object'
      ? record
      : null
}

function storageTimestamp(record) {
  if (record?.__cineblockStorageRecord !== true) return 0
  const timestamp = Number(record.savedAt)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0
}

export function selectNewestStorageRecord(databaseRecord, fallbackRecord) {
  const databaseTimestamp = storageTimestamp(databaseRecord)
  const fallbackTimestamp = storageTimestamp(fallbackRecord)

  return fallbackRecord && fallbackTimestamp > databaseTimestamp
    ? fallbackRecord
    : databaseRecord || fallbackRecord || null
}

export async function loadAppState() {
  let databaseRecord = null
  try {
    const database = await openDatabase()
    databaseRecord = await readFromDatabase(database)
  } catch (error) {
    console.warn('CINEBLOCK could not read IndexedDB; checking the compatibility save:', error)
  }

  const fallbackRecord = readLegacyLocalStorage()
  const selectedRecord = selectNewestStorageRecord(databaseRecord, fallbackRecord)

  if (selectedRecord === fallbackRecord && fallbackRecord) {
    const state = unwrapStorageRecord(fallbackRecord)
    // Best-effort repair: if a newer fallback survived an IndexedDB failure, restore it
    // to IndexedDB so the stale database record cannot keep winning after this load.
    try {
      const database = await openDatabase()
      await writeToDatabase(database, createStorageRecord(state))
    } catch (error) {
      console.warn('CINEBLOCK could not restore the compatibility save to IndexedDB:', error)
    }
    return state
  }

  if (selectedRecord) {
    return unwrapStorageRecord(selectedRecord)
  }

  return null
}

async function persistAppState(value) {
  const record = createStorageRecord(value)
  try {
    const database = await openDatabase()
    await writeToDatabase(database, record)

    // Keep the compatibility copy current after every successful primary save.
    // localStorage can be unavailable or over quota, so mirror failure must not
    // turn a successful IndexedDB save into a reported save failure.
    try {
      globalThis.window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(record))
    } catch {
      // IndexedDB remains the source of truth when the compatibility copy cannot be written.
    }

    notifyOtherTabs()
  } catch (error) {
    // Fallback records retain a timestamp so recovery can prefer them over stale IndexedDB data.
    try {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(record))
      notifyOtherTabs()
    } catch (fallbackError) {
      throw fallbackError || error
    }
  }
}


// Serialize writes so a slower earlier save cannot overwrite a newer snapshot.
// Keep the queue alive after a failed save; the next edit can still be persisted.
export function saveAppState(value) {
  const operation = saveQueue.then(() => persistAppState(value))
  saveQueue = operation.catch(() => {})
  return operation
}

// Flush a synchronous recovery copy before a refresh or tab close. IndexedDB
// writes remain queued as the primary save, while loadAppState prefers this
// timestamped copy if the browser closes before the transaction completes.
export function saveAppStateOnExit(value) {
  let fallbackError = null
  try {
    const record = createStorageRecord(value)
    globalThis.window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(record))
  } catch (error) {
    fallbackError = error
  }

  const operation = saveAppState(value)
  return fallbackError
    ? operation.catch(error => { throw error || fallbackError })
    : operation
}
