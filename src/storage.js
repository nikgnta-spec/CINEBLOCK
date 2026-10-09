const DATABASE_NAME = 'cineblock-local'
const DATABASE_VERSION = 1
const STORE_NAME = 'appState'
const PRIMARY_KEY = 'primary'
const LEGACY_STORAGE_KEY = 'cineblock.app-state.v1'

let databasePromise

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser'))
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

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

function readLegacyLocalStorage() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.warn('CINEBLOCK could not read the older browser save:', error)
    return null
  }
}

export async function loadAppState() {
  try {
    const database = await openDatabase()
    const saved = await readFromDatabase(database)
    if (saved && typeof saved === 'object') return saved

    // One-time migration from the earlier localStorage-based autosave.
    const legacy = readLegacyLocalStorage()
    if (legacy) {
      try {
        await writeToDatabase(database, legacy)
      } catch (error) {
        console.warn('CINEBLOCK could not migrate the older browser save:', error)
      }
      return legacy
    }

    return null
  } catch (error) {
    console.warn('CINEBLOCK is using the compatibility storage fallback:', error)
    return readLegacyLocalStorage()
  }
}

export async function saveAppState(value) {
  try {
    const database = await openDatabase()
    await writeToDatabase(database, value)
  } catch (error) {
    // Fallback for browsers where IndexedDB is unavailable. Very large projects
    // may exceed localStorage quota; surface that error in the app's save status.
    try {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(value))
    } catch (fallbackError) {
      throw fallbackError || error
    }
  }
}
