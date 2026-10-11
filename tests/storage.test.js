import test from 'node:test'
import assert from 'node:assert/strict'
import { selectNewestStorageRecord } from '../src/storage.js'

const record = (savedAt, title) => ({
  __cineblockStorageRecord: true,
  savedAt,
  state: { project: { title } },
})

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
